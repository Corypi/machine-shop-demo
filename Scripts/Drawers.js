(function () {
  "use strict";

  // ==========================================================
  // SnapManager
  // Single, boringly-reliable snapping primitive used everywhere.
  // Relies on CSS `scroll-margin-top: var(--TabBarOffsetPixels)` set
  // on drawer titles (see main.css). We only:
  //  1) keep --TabBarOffsetPixels in sync with TabBar height,
  //  2) wait briefly for a stable layout,
  //  3) call scrollIntoView, then verify & nudge by a pixel if needed.
  // ==========================================================
  var SnapManager = (function(){
    var MaxWaitMs = 500;              // Hard cap to avoid hanging forever
    var ConsecutiveStableFrames = 2;  // Frames with identical measurements

    function _tabBar(){ return document.getElementById("TabBar"); }
    function _container(){ return document.querySelector(".Container"); }
    function _titleOf(drawer){ return drawer.querySelector("[data-drawer-summary]") || drawer; }

    function _barBottom(){
      var bar = _tabBar();
      return bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
    }

    // Keep the CSS variable in sync with actual TabBar height
    function UpdateTabBarOffsetVar(){
      var px = _barBottom();
      document.documentElement.style.setProperty("--TabBarOffsetPixels", px + "px");
    }

    // Wait until TabBar/padding/layout are stable (2 identical frames or timeout)
    function WaitStable(callback){
      var nowTs = (window.performance && performance.now) ? function(){ return performance.now(); } : function(){ return Date.now(); };
      var start = nowTs();
      var prevSig = null, stableCount = 0;

      function frame(){
        var barBtm = _barBottom();
        var cont = _container();
        var pt = cont ? Math.round(parseFloat(getComputedStyle(cont).paddingTop) || 0) : 0;
        var vis = document.body.classList.contains("Tabs--Visible") ? 1 : 0;
        var sig = barBtm + "|" + pt + "|" + vis;

        stableCount = (prevSig !== null && sig === prevSig) ? (stableCount + 1) : 1;
        prevSig = sig;

        if (stableCount >= ConsecutiveStableFrames) { callback(); return; }

        if (nowTs() - start > MaxWaitMs) { callback(); return; }

        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    // Scroll so the drawer title lands under the TabBar; verify & nudge.
    function SnapToTitle(drawer, behavior){
      if (!drawer) return;
      var title = _titleOf(drawer);

      // First attempt: spec-compliant; honors scroll-margin-top.
      title.scrollIntoView({ block: "start", inline: "nearest", behavior: behavior || "auto" });

      // Verify on the next frame and nudge by exact delta if needed.
      requestAnimationFrame(function(){
        var delta = Math.round(title.getBoundingClientRect().top - _barBottom());
        if (delta) { window.scrollBy({ top: delta, behavior: "auto" }); }
      });
    }

    return {
      UpdateTabBarOffsetVar: UpdateTabBarOffsetVar,
      WaitStable: WaitStable,
      SnapToTitle: SnapToTitle
    };
  })();

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
        if (this._isAnimating) break;
      }
    };

    this._now = function () {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    };

    this.Initialize();
  }

  // ---------- Helpers: hero + TabBar + Tab-Mode visibility ----------

  DrawerController.prototype._heroId = function(){
    if (!this._drawers || !this._drawers.length) return null;
    return this._drawers[0] && this._drawers[0].id ? this._drawers[0].id : null;
  };

  DrawerController.prototype._tabBarEl = function(){
    return document.getElementById("TabBar");
  };

  DrawerController.prototype._isTabMode = function(){
    // "Tab mode" means the fixed TabBar is visible.
    return document.body.classList.contains("Tabs--Visible");
  };

  // Hide all drawers except the active one (tab mode only).
  // In non-tab mode, keep legacy behavior (all visible in flow).
  DrawerController.prototype._applyTabModeVisibility = function(activeId){
    var inTabMode = this._isTabMode();
    for (var i = 0; i < this._drawers.length; i++){
      var d = this._drawers[i];
      if (!inTabMode){
        d.removeAttribute("hidden");
        d.style.display = "";
        continue;
      }
      if (d.id === activeId){
        d.removeAttribute("hidden");
        d.style.display = "";
      } else {
        d.setAttribute("hidden", "");
        d.style.display = "none";
      }
    }
  };

  DrawerController.prototype._ensureTabBarVisible = function(){
    var bar = this._tabBarEl();
    if (bar){
      document.body.classList.add("Tabs--Visible");
      bar.setAttribute("aria-hidden", "false");
      SnapManager.UpdateTabBarOffsetVar(); // keep CSS offset in sync
    }
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
    drawer.setAttribute("hidden", "");
    drawer.style.display = "none";

    // force a reflow so layout updates
    void document.body.offsetHeight;

    // 🔔 tell everyone the hero is gone
    document.dispatchEvent(new CustomEvent("hero:collapsed", { detail: { id: drawer.id }}));
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

    // Keep TabBar offset var fresh on resize/orientation
    window.addEventListener("resize", function(){ SnapManager.UpdateTabBarOffsetVar(); }, { passive: true });

    // Enforce tab-mode visibility whenever a drawer actually opens.
    var self = this;
    document.addEventListener("drawer:opened", function(e){
      if (e && e.detail && e.detail.id){ self._applyTabModeVisibility(e.detail.id); }
    });

    // If the page is already in tab-mode on load, keep only the active open drawer in flow.
    if (this._isTabMode()){
      var activeOpen = null;
      for (var k = 0; k < this._drawers.length; k++){
        if (this._drawers[k].classList.contains("Drawer--Open")) { activeOpen = this._drawers[k].id; break; }
      }
      if (activeOpen){ this._applyTabModeVisibility(activeOpen); }
    }
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

      // If opening something that is NOT the hero, instantly remove hero from flow and show tabs first
      if (heroId && drawer.id !== heroId) {
        var hero = document.getElementById(heroId);
        if (hero && hero.style.display !== "none") {
          this._forceRemoveFromFlow(hero);
        }
        this._ensureTabBarVisible();
      }

      this.OpenDrawer(drawer);

      if (OnlyOneOpenAtATime) {
        if (this._isAnimating) {
          var self2 = this;
          this._enqueue(function(){ self2.CloseSiblings(drawer, /*removeHero*/true); });
        } else {
          this.CloseSiblings(drawer, /*removeHero*/true);
        }
      }

      // Unified, robust snap: ensure offset reflects current bar size, wait for stability, then scroll to title.
      SnapManager.UpdateTabBarOffsetVar();
      var self3 = this;
      SnapManager.WaitStable(function(){ self3.ScrollToDrawer(drawer.id); });
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

    // 🔔 notify tab bar / observers (opened state)
    document.dispatchEvent(new CustomEvent("drawer:opened", { detail: { id: drawer.id }}));

    var self = this;

    function measureEndHeight() {
      var prevH = content.style.height;
      var prevT = content.style.transition;
      content.style.transition = "";
      content.style.height = ""; // let CSS open-state height apply
      void content.offsetHeight;

      var end = content.getBoundingClientRect().height;
      if (!end || end < 1) { end = content.scrollHeight; }

      // Restore start height for the animation
      content.style.height = prevH || (Math.max(0, startHeight) + "px");
      content.style.transition = prevT;
      void content.offsetHeight;
      return Math.max(0, Math.round(end));
    }

    requestAnimationFrame(function () {
      var endHeight = measureEndHeight();

      if (Math.abs(endHeight - startHeight) < 0.5) {
        content.style.transition = "";
        if (drawer.classList.contains("Drawer--FixedHero") ||
            drawer.classList.contains("Drawer--FixedShort") ||
            content.classList.contains("DrawerContent--Fill")) {
          content.style.height = "";
        } else {
          content.style.height = "auto";
        }
        self._isAnimating = false;
        self._drainQueue();
        return;
      }

      self.AnimateHeight(content, startHeight, endHeight);
    });

    this._wireMediaAutoGrow(content);
  };

  DrawerController.prototype.CloseDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.remove("Drawer--Open");
    drawer.classList.remove("Drawer--NoTail");
    this.SetAriaExpanded(drawer, false);

    // If the closed drawer is the hero, collapse it out of flow and show the tab bar
    var heroIdNow = this._heroId();
    if (heroIdNow && drawer.id === heroIdNow) {
      this._forceRemoveFromFlow(drawer);
      this._ensureTabBarVisible();
    }

    document.dispatchEvent(new CustomEvent("drawer:closed", { detail: { id: drawer.id }}));

    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].pause(); vids[i].currentTime = 0; } catch (e) {}
    }

    var endHeight = 0;
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

  // Close siblings; in tab-mode, also fully hide them from flow.
  DrawerController.prototype.CloseSiblings = function (exceptDrawer, removeHero) {
    var heroId = this._heroId();
    var inTabMode = this._isTabMode();

    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      if (d === exceptDrawer) continue;

      // 1) close any open sibling
      if (d.classList.contains("Drawer--Open")) {
        this.CloseDrawer(d);
      }

      // 2) special-case hero: never re-show it once we’re removing it
      if (removeHero && heroId && d.id === heroId) {
        if (d.style.display !== "none" || !d.hasAttribute("hidden")) {
          this._forceRemoveFromFlow(d);
        }
        continue;
      }

      // 3) visibility policy
      if (inTabMode) {
        d.setAttribute("hidden", "");
        d.style.display = "none";
      } else {
        d.removeAttribute("hidden");
        d.style.display = "";
      }
    }
  };

  // ---------- Animation + ARIA ----------

  DrawerController.prototype.AnimateHeight = function (element, startHeight, endHeight) {
    var self = this;

    if (this._isAnimating) {
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

        if (drawer.classList.contains("Drawer--FixedHero") ||
            drawer.classList.contains("Drawer--FixedShort") ||
            content.classList.contains("DrawerContent--Fill")) {
          content.style.height = "";
        } else {
          content.style.height = "auto";
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
    if (heroId && id !== heroId) {
      var hero = document.getElementById(heroId);
      if (hero && hero.style.display !== "none") {
        this._forceRemoveFromFlow(hero);
      }
      this._ensureTabBarVisible();
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

    // Unified snap after open: sync offset, wait stable, then scroll.
    SnapManager.UpdateTabBarOffsetVar();
    var self3 = this;
    SnapManager.WaitStable(function(){ self3.ScrollToDrawer(id); });
  };

  DrawerController.prototype.CloseById = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    if (drawer.classList.contains("Drawer--Open")) this.CloseAndLock(drawer);
  };

  // Public scroll that uses SnapManager (kept for TabBar.js / external callers)
  DrawerController.prototype.ScrollToDrawer = function (id) {
    var el = typeof id === "string" ? document.getElementById(id) : id;
    if (!el) return;
    SnapManager.WaitStable(function(){
      SnapManager.SnapToTitle(el, "auto");
    });
  };

  // Programmatic sequence: open one, optionally close another, then snap.
  DrawerController.prototype.OpenThenCloseAndScroll = function (openId, closeId) {
    var self = this;
    var heroId = this._heroId();

    function openAndSnap() {
      self.OpenById(openId);

      // After "opened", wait stable, then snap.
      function onOpened(e){
        if (!e || !e.detail || e.detail.id !== openId) return;
        document.removeEventListener("drawer:opened", onOpened);
        SnapManager.UpdateTabBarOffsetVar();
        SnapManager.WaitStable(function(){
          self.ScrollToDrawer(openId);
        });
      }
      document.addEventListener("drawer:opened", onOpened);
    }

    // If skipping the hero, remove it & show tabs first
    if (closeId && heroId && closeId === heroId) {
      var hero = document.getElementById(closeId);
      if (hero && hero.style.display !== "none") {
        this._forceRemoveFromFlow(hero);
      }
      this._ensureTabBarVisible();
      SnapManager.UpdateTabBarOffsetVar();
      requestAnimationFrame(openAndSnap);
      return;
    }

    // Non-hero path
    if (closeId) this.CloseById(closeId);
    requestAnimationFrame(openAndSnap);
  };

  // ---------- Boot ----------

  function InitializeDrawersWhenReady() {
    var instance = new DrawerController(document);
    window.DrawersController = instance;

    function openIntro() {
      var intro = document.getElementById("Intro");
      if (!intro) return;

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