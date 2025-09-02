(function () {
  "use strict";

  // ===== Configuration =====
  var AnimationDurationMs = 220;
  var OnlyOneOpenAtATime  = true;

  // Anti-flap after programmatic close
  var SuppressMsAfterProgrammaticClose = 250;

  // ============================================

  function DrawerController(root) {
    this._root        = root;
    this._isAnimating = false;

    this._drawers   = null;
    this._summaries = null;

    // ---- Single-flight queue (one animation at a time) ----
    this._queue = [];
    this._enqueue = function (fn) {
      if (typeof fn === "function") this._queue.push(fn);
    };
    this._drainQueue = function () {
      if (this._isAnimating) return;
      while (this._queue.length) {
        var fn = this._queue.shift();
        try { fn(); } catch (e) {}
        if (this._isAnimating) break; // stop if the action kicked a new animation
      }
    };

    this._now = function () {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    };

    this.Initialize();
  }

  // ---------- Helpers: hero + TabBar + snap ----------

  DrawerController.prototype._heroId = function(){
    if (!this._drawers || !this._drawers.length) return null;
    return this._drawers[0] && this._drawers[0].id ? this._drawers[0].id : null;
  };

  DrawerController.prototype._tabBarEl = function(){
    return document.getElementById("TabBar");
  };

  DrawerController.prototype._tabBarHeight = function(){
    var el = this._tabBarEl();
    var h = el ? el.getBoundingClientRect().height : 56;
    return (h && h > 0) ? h : 56;
  };

  DrawerController.prototype._ensureTabBarVisible = function(){
    var bar = this._tabBarEl();
    if (bar){
      document.body.classList.add("Tabs--Visible");
      bar.setAttribute("aria-hidden", "false");
    }
  };

  DrawerController.prototype._snapUnderTabs = function(drawer){
    if (!drawer) return;
    var title = drawer.querySelector("[data-drawer-summary]") || drawer;
    var y = title.getBoundingClientRect().top + window.pageYOffset - this._tabBarHeight();
    window.scrollTo({ top: y, behavior: "auto" });
  };

  // Retry snapping until TabBar has a real height (first-time open)
  DrawerController.prototype._snapUnderTabsDeferred = function(drawer){
    var self = this, tries = 0, maxTries = 24;
    function ready(){
      var bar = self._tabBarEl();
      var h = bar ? bar.getBoundingClientRect().height : 0;
      return h > 1 && document.body.classList.contains("Tabs--Visible");
    }
    (function loop(){
      if (ready()){ self._snapUnderTabs(drawer); return; }
      if (++tries >= maxTries){ self._snapUnderTabs(drawer); return; }
      requestAnimationFrame(loop);
    })();
  };

  // Instantly remove a drawer from layout (no animation)
  DrawerController.prototype._forceRemoveFromFlow = function(drawer){
    if (!drawer) return;

    // pause any media
    try {
      var vids = drawer.querySelectorAll("video");
      for (var i = 0; i < vids.length; i++) { vids[i].pause(); }
    } catch(_) {}

    // clear any height/transition crud
    var content = drawer.querySelector("[data-drawer-content]");
    if (content){
      content.style.transition = "";
      content.style.height = "";
    }

    // ensure ARIA reflects closed
    this.SetAriaExpanded(drawer, false);

    drawer.classList.remove("Drawer--Open", "Drawer--NoTail");

    // robust hide (covers most CSS)
    drawer.setAttribute("hidden", "");
    drawer.style.display = "none"; // belt + suspenders

    // force a reflow so layout updates before we snap
    void document.body.offsetHeight;

    // let listeners know the hero is collapsed
    document.dispatchEvent(new CustomEvent("drawer:collapsed", { detail: { id: drawer.id }}));
  };

  // ===================================================

  DrawerController.prototype.Initialize = function () {
    this._drawers   = this._root.querySelectorAll("[data-drawer]");
    this._summaries = this._root.querySelectorAll("[data-drawer-summary]");

    // Start EVERYTHING closed, visible in flow (no display:none)
    for (var j = 0; j < this._drawers.length; j++) {
      var d = this._drawers[j];
      d.classList.remove("Drawer--Open", "Drawer--NoTail");
      d.removeAttribute("hidden");
      d.style.display = "";
      var c = d.querySelector("[data-drawer-content]");
      if (c) c.style.height = "";
    }

    // Wire summary clicks/keys
    for (var i = 0; i < this._summaries.length; i++) {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    this.SyncAria();
    this.SyncHeights();
  };

  // ---------- Interaction ----------

  DrawerController.prototype.OnSummaryKeyDown = function (evt) {
    var key = evt.key || "";
    if (key === " " || key === "Enter" || evt.keyCode === 32 || evt.keyCode === 13) {
      evt.preventDefault();
      this.OnToggleRequested(evt);
    }
  };

  DrawerController.prototype.OnToggleRequested = function (evt) {
    if (this._isAnimating) {
      var self = this, target = evt.currentTarget;
      this._enqueue(function () {
        self.OnToggleRequested({ currentTarget: target, key: "queued" });
      });
      return;
    }

    var summary = evt.currentTarget;
    var drawer  = summary.closest ? summary.closest("[data-drawer]") : this._FindAncestorDrawer(summary);
    if (!drawer) return;

    var heroId = this._heroId();

    if (drawer.classList.contains("Drawer--Open")) {
      this.CloseAndLock(drawer);
    } else {
      drawer.style.display = ""; // ensure visible
      var self2 = this;

      // If opening something that is NOT the hero, instantly remove hero from flow
      if (heroId && drawer.id !== heroId) {
        var hero = document.getElementById(heroId);
        if (hero && hero.style.display !== "none") {
          this._forceRemoveFromFlow(hero);
          this._ensureTabBarVisible();
        } else {
          this._ensureTabBarVisible();
        }
      }

      self2.OpenDrawer(drawer);

      if (OnlyOneOpenAtATime) {
        if (self2._isAnimating) {
          self2._enqueue(function(){ self2.CloseSiblings(drawer, /*removeHero*/true); });
        } else {
          self2.CloseSiblings(drawer, /*removeHero*/true);
        }
      }

      self2._snapUnderTabsDeferred(drawer);
    }
  };

  // ---------- Programmatic open/close ----------

  DrawerController.prototype.OpenDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    // Tail state for fill content
    if (content.classList.contains("DrawerContent--Fill")) {
      drawer.classList.add("Drawer--NoTail");
    } else {
      drawer.classList.remove("Drawer--NoTail");
    }

    var startHeight = content.getBoundingClientRect().height | 0;

    // Pin current height so we don't collapse while we prep animation
    content.style.height = Math.max(0, startHeight) + "px";

    drawer.classList.add("Drawer--Open");
    this.SetAriaExpanded(drawer, true);

    // 🔔 notify tab bar
    document.dispatchEvent(new CustomEvent("drawer:opened", { detail: { id: drawer.id }}));

    var self = this;

    function measureEndHeight() {
      var prevH = content.style.height;
      var prevT = content.style.transition;
      content.style.transition = "";
      content.style.height = ""; // let CSS open-state height apply
      void content.offsetHeight;

      var end = content.getBoundingClientRect().height;
      if (!end || end < 1) {
        end = content.scrollHeight;
      }

      // Restore start height for the animation
      content.style.height = prevH || (Math.max(0, startHeight) + "px");
      content.style.transition = prevT;
      void content.offsetHeight;
      return Math.max(0, Math.round(end));
    }

    // Run after layout applies the open class
    requestAnimationFrame(function () {
      var endHeight = measureEndHeight();

      // Fast-path: if there's nothing to animate, finish immediately (prevents lock)
      if (Math.abs(endHeight - startHeight) < 0.5) {
        content.style.transition = "";
        // keep clamp-driven drawers on CSS height; others can be auto
        if (drawer.classList.contains("Drawer--FixedHero") ||
            drawer.classList.contains("Drawer--FixedShort") ||
            content.classList.contains("DrawerContent--Fill")) {
          content.style.height = "";   // let CSS clamp win
        } else {
          content.style.height = "auto";
        }
        self._isAnimating = false;
        self._drainQueue();
        return;
      }

      self.AnimateHeight(content, startHeight, endHeight);
    });

    // Keep open panels healthy if media sizes even later
    this._wireMediaAutoGrow(content);
  };

  DrawerController.prototype.CloseDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.remove("Drawer--Open");
    drawer.classList.remove("Drawer--NoTail");
    this.SetAriaExpanded(drawer, false);

    // 🔔 notify tab bar
    document.dispatchEvent(new CustomEvent("drawer:closed", { detail: { id: drawer.id }}));

    // Pause/rewind any videos in this drawer
    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].pause(); vids[i].currentTime = 0; } catch (e) {}
    }

    var endHeight = 0;
    // If nothing to animate, finish immediately
    if (Math.abs(endHeight - startHeight) < 0.5) {
      content.style.transition = "";
      content.style.height = "";
      this._isAnimating = false;
      this._drainQueue();
      return;
    }

    this.AnimateHeight(content, startHeight, endHeight);
  };

  DrawerController.prototype.CloseAndLock = function (drawer) {
    this.CloseDrawer(drawer);
    drawer.dataset.lockedUntil = String(this._now() + SuppressMsAfterProgrammaticClose);
  };

  /**
   * Close siblings; if removeHero=true, the hero (Intro) is instantly removed from flow.
   */
  DrawerController.prototype.CloseSiblings = function (exceptDrawer, removeHero) {
    var heroId = this._heroId();
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      if (d === exceptDrawer) continue;

      if (d.classList.contains("Drawer--Open")) {
        this.CloseDrawer(d);
      }

      if (removeHero && heroId && d.id === heroId && d.style.display !== "none") {
        this._forceRemoveFromFlow(d); // ← instant removal, no pause
      } else {
        d.removeAttribute("hidden");
        d.style.display = ""; // keep others visible in flow
      }
    }
  };

  // ---------- Animation + ARIA ----------

  DrawerController.prototype.AnimateHeight = function (element, startHeight, endHeight) {
    var self = this;

    if (this._isAnimating) {
      // snap any in-flight to end state to avoid lock
      element.style.transition = "";
      element.style.height = endHeight > 0 ? (endHeight + "px") : "";
    }

    this._isAnimating = true;

    element.style.height = Math.max(0, startHeight) + "px";
    void element.offsetHeight;

    element.style.transition = "height " + AnimationDurationMs + "ms ease";
    element.style.height = Math.max(0, endHeight) + "px";

    function onEnd(e) {
      if (e.propertyName !== "height") return;
      element.removeEventListener("transitionend", onEnd);

      element.style.transition = "";

      // For fixed-video drawers, clear inline height so CSS clamp applies.
      // For regular content, 'auto' is fine.
      var drawer = element.closest && element.closest(".Drawer");
      var useCssClamp = drawer &&
                        (drawer.classList.contains("Drawer--FixedHero") ||
                         drawer.classList.contains("Drawer--FixedShort")) ||
                        element.classList.contains("DrawerContent--Fill");

      if (endHeight > 0) {
        element.style.height = useCssClamp ? "" : "auto";
      } else {
        element.style.height = "";
      }

      self._isAnimating = false;

      // drain queued actions
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          self._drainQueue();
        });
      });
    }

    element.addEventListener("transitionend", onEnd);
  };

  DrawerController.prototype.SyncAria = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var drawer = this._drawers[i];
      var summary = drawer.querySelector("[data-drawer-summary]");
      if (!summary) continue;
      summary.setAttribute("aria-expanded", drawer.classList.contains("Drawer--Open") ? "true" : "false");
    }
  };

  DrawerController.prototype.SetAriaExpanded = function (drawer, expanded) {
    var summary = drawer.querySelector("[data-drawer-summary]");
    if (summary) summary.setAttribute("aria-expanded", expanded ? "true" : "false");
  };

  DrawerController.prototype.SyncHeights = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var drawer = this._drawers[i];
      var content = drawer.querySelector("[data-drawer-content]");
      if (!content) continue;

      if (drawer.classList.contains("Drawer--Open")) {
        if (content.classList.contains("DrawerContent--Fill")) {
          drawer.classList.add("Drawer--NoTail");
        } else {
          drawer.classList.remove("Drawer--NoTail");
        }

        // Match AnimateHeight behavior:
        // fixed-video drawers rely on CSS clamp; others can use 'auto'
        if (drawer.classList.contains("Drawer--FixedHero") ||
            drawer.classList.contains("Drawer--FixedShort") ||
            content.classList.contains("DrawerContent--Fill")) {
          content.style.height = "";      // let CSS rule control height
        } else {
          content.style.height = "auto";  // normal content
        }

      } else {
        drawer.classList.remove("Drawer--NoTail");
        content.style.height = "";
      }
    }
  };

  // Keep an open drawer healthy if media sizes late
  DrawerController.prototype._wireMediaAutoGrow = function (content) {
    var medias = content.querySelectorAll("video, img, iframe");
    function maybeSync() {
      var d = content.closest("[data-drawer]");
      if (!d || !d.classList.contains("Drawer--Open")) return;
      if (!(d.classList.contains("Drawer--FixedHero") ||
            d.classList.contains("Drawer--FixedShort") ||
            content.classList.contains("DrawerContent--Fill"))) {
        content.style.height = "auto";
      }
    }
    for (var i = 0; i < medias.length; i++) {
      var m = medias[i];
      m.addEventListener("loadedmetadata", maybeSync);
      m.addEventListener("loadeddata",     maybeSync);
      m.addEventListener("load",           maybeSync);
    }
  };

  // --- Optional: auto-advance a video drawer ---
  DrawerController.prototype._wireAutoAdvanceVideo = function (drawerId, nextId) {
    var drawer = document.getElementById(drawerId);
    if (!drawer) return;
    var content = drawer.querySelector("[data-drawer-content]");
    var video   = content ? content.querySelector("video") : null;
    if (!video) return;

    var self = this;
    var started = false;

    function tryPlay() {
      try {
        video.muted = true;
        video.playsInline = true;
        var p = video.play();
        if (p && typeof p.catch === "function") p.catch(function(){});
      } catch(e) {}
    }

    video.addEventListener("playing", function () { started = true; }, { passive:true });
    video.addEventListener("loadedmetadata", function () { tryPlay(); }, { passive:true });

    video.addEventListener("ended", function () {
      if (!started) return;
      if (!drawer.classList.contains("Drawer--Open")) return;

      if (nextId) {
        self.OpenThenCloseAndScroll(nextId, drawerId);
      } else {
        self.CloseAndLock(drawer);
      }
    }, { passive:true });
  };

  // ---------- Public helpers ----------

  DrawerController.prototype._FindAncestorDrawer = function (node) {
    while (node && node !== document) {
      if (node.hasAttribute && node.hasAttribute("data-drawer")) return node;
      node = node.parentNode;
    }
    return null;
  };

  DrawerController.prototype.OpenById = function (id) {
    if (this._isAnimating) {
      var self = this;
      this._enqueue(function(){ self.OpenById(id); });
      return;
    }

    var drawer = document.getElementById(id);
    if (!drawer) return;

    var heroId = this._heroId();
    // If opening a non-hero, instantly remove hero from flow
    if (heroId && id !== heroId) {
      var hero = document.getElementById(heroId);
      if (hero && hero.style.display !== "none") {
        this._forceRemoveFromFlow(hero);
        this._ensureTabBarVisible();
      } else {
        this._ensureTabBarVisible();
      }
    }

    drawer.removeAttribute("hidden");
    drawer.style.display = "";
    if (!drawer.classList.contains("Drawer--Open")) {
      this.OpenDrawer(drawer);

      if (OnlyOneOpenAtATime) {
        var self2 = this;
        if (this._isAnimating) {
          this._enqueue(function(){ self2.CloseSiblings(drawer, /*removeHero*/true); });
        } else {
          self2.CloseSiblings(drawer, /*removeHero*/true);
        }
      }
    }

    this._snapUnderTabsDeferred(drawer);
  };

  DrawerController.prototype.CloseById = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    if (drawer.classList.contains("Drawer--Open")) this.CloseAndLock(drawer);
  };

  DrawerController.prototype.ScrollToDrawer = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    var title = drawer.querySelector("[data-drawer-summary]") || drawer;
    var y = title.getBoundingClientRect().top + window.pageYOffset - this._tabBarHeight();
    window.scrollTo({ top: y, behavior: "auto" });
  };

  DrawerController.prototype.OpenThenCloseAndScroll = function (openId, closeId) {
    // If closing the hero, remove it from flow *immediately* — no waiting
    var heroId = this._heroId();
    if (closeId && heroId && closeId === heroId) {
      var hero = document.getElementById(closeId);
      if (hero && hero.style.display !== "none") {
        this._forceRemoveFromFlow(hero);
        this._ensureTabBarVisible();
      } else {
        this._ensureTabBarVisible();
      }
      this.OpenById(openId);
      var target = document.getElementById(openId);
      this._snapUnderTabsDeferred(target);
      requestAnimationFrame(this._snapUnderTabsDeferred.bind(this, target));
      return;
    }

    // Otherwise close then open (non-hero path)
    if (closeId) this.CloseById(closeId);
    this.OpenById(openId);
    var t2 = document.getElementById(openId);
    this._snapUnderTabsDeferred(t2);
  };

  // ---------- Boot ----------

  function InitializeDrawersWhenReady() {
    var instance = new DrawerController(document);
    window.DrawersController = instance;

    // Open Intro once layout settles (optional)
    function openIntro() {
      var intro = document.getElementById("Intro");
      if (!intro) return;

      // Optional: auto-advance example Intro -> About
      instance._wireAutoAdvanceVideo("Intro", "About");

      instance.OpenById("Intro");

      var vid = intro.querySelector("video");
      if (vid) {
        try {
          vid.muted = true;
          vid.playsInline = true;
          var p = vid.play();
          if (p && typeof p.catch === "function") p.catch(function(){});
        } catch (e) {}
      }
    }

    requestAnimationFrame(function(){ requestAnimationFrame(openIntro); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeDrawersWhenReady);
  } else {
    InitializeDrawersWhenReady();
  }

  window.DrawerController = DrawerController;
})();