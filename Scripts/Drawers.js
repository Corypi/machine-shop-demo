(function () {
  "use strict";

  // ===== Configuration =====
  var AnimationDurationMs = 220;
  var OnlyOneOpenAtATime = true;

  // Auto open/close on scroll via a single “virtual line”
  var AutoOpenOnScroll = true;
  var ViewportAnchorFraction = 0.35; // 35% from the top
  var OpenOffsetPx = 28;             // open slightly *below* that line

  // Anti-flap after programmatic close
  var SuppressMsAfterProgrammaticClose = 250;

  // Suppress IO reactions briefly during boot/programmatic open
  var SuppressIOAfterBootMs = 400;

  // Percent slice around our line (geometry guard enforces offset)
  function computeRootMargin() {
    var topPct = -(ViewportAnchorFraction * 100);
    var botPct = -(100 - ViewportAnchorFraction * 100);
    return topPct.toFixed(3) + "% 0px " + botPct.toFixed(3) + "% 0px";
  }

  // ============================================

  function DrawerController(root) {
    this._root = root;
    this._isAnimating = false;

    this._drawers = null;
    this._summaries = null;
    this._observer = null;

    // Direction tracking
    this._lastScrollY = window.pageYOffset || 0;
    this._scrollDirection = 1; // seed as "down"

    // Boot/IO suppression
    this._booting = true;
    this._suppressIOUntil = 0;

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

    // ----- Scroll Input Gate (freeze & accumulate) -----
this._freezeUntil = 0;       // time (ms) until we allow IO
this._blockScroll = false;   // actively prevent default scrolling
this._accumulatedInput = 0;  // ABSOLUTE distance tracker (legacy)
this._accumulatedSigned = 0; // NEW: signed distance tracker (+down, -up)
this._touchStartY = null;

this.FreezeInput = function(ms){
  var now = this._now();
  this._freezeUntil = now + (ms || 500);
  this._blockScroll = true;
  this._accumulatedInput = 0;
  this._accumulatedSigned = 0;
  var self = this;
  // release hard block a bit earlier; IO still gated by _freezeUntil
  setTimeout(function(){ self._blockScroll = false; }, Math.min(ms || 500, 400));
};

this.ResetAccumulatedInput = function(){
  this._accumulatedInput = 0;
  this._accumulatedSigned = 0;
};

this._isFrozen = function(){
  return this._now() < this._freezeUntil;
};

// NEW: one place to keep our “detent” distance
this._threshold = function(){
  // Tunable: how much user scroll input must be applied to step sections
  return 320; // px of input (wheel/touch/key), adjust to taste
};

    this.Initialize();
  }

  DrawerController.prototype.Initialize = function () {
    this._drawers = this._root.querySelectorAll("[data-drawer]");
    this._summaries = this._root.querySelectorAll("[data-drawer-summary]");

    // Start EVERYTHING closed (ignore whatever HTML had)
    for (var j = 0; j < this._drawers.length; j++) {
      var d = this._drawers[j];
      d.classList.remove("Drawer--Open", "Drawer--NoTail");
      var c = d.querySelector("[data-drawer-content]");
      if (c) c.style.height = "";
    }

    // Wire summary clicks/keys
    for (var i = 0; i < this._summaries.length; i++) {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    // NEW: install close-markers so we can react when scrolling upward
    this._InstallCloseMarkers();

    this.SyncAria();
    this.SyncHeights();

    if (AutoOpenOnScroll) this.EnableScrollAutoToggle();
  };

  // Add a tiny sentinel at the end of each drawer content
  DrawerController.prototype._InstallCloseMarkers = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      var content = d.querySelector("[data-drawer-content]");
      if (!content) continue;
      if (!content.querySelector("[data-close-marker]")) {
        var marker = document.createElement("div");
        marker.setAttribute("data-close-marker", "");
        marker.style.cssText = "position:relative;height:1px;width:1px;pointer-events:none;";
        content.appendChild(marker);
      }
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
    // Queue user clicks if an animation is active
    if (this._isAnimating) {
      var self = this, target = evt.currentTarget;
      this._enqueue(function () {
        self.OnToggleRequested({ currentTarget: target, key: "queued" });
      });
      return;
    }

    var summary = evt.currentTarget;
    var drawer = summary.closest ? summary.closest("[data-drawer]") : this._FindAncestorDrawer(summary);
    if (!drawer) return;

    if (drawer.classList.contains("Drawer--Open")) {
      this.CloseAndLock(drawer);
    } else {
      this.OpenDrawer(drawer);
      // suppress IO briefly so the open-induced layout shift doesn't auto-open the next drawer
      this._suppressIOUntil = this._now() + 450;

      if (OnlyOneOpenAtATime) {
        var self2 = this;
        // Queue sibling closes if an animation will run
        if (this._isAnimating) {
          this._enqueue(function(){ self2.CloseSiblings(drawer); });
        } else {
          this.CloseSiblings(drawer);
        }
      }
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

    // Measure end height with inline height cleared so CSS (dvh clamp) can apply
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

  DrawerController.prototype.CloseSiblings = function (exceptDrawer) {
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      if (d !== exceptDrawer && d.classList.contains("Drawer--Open")) {
        this.CloseDrawer(d);
      }
    }
  };

  // ---------- Animation + ARIA ----------

  DrawerController.prototype.AnimateHeight = function (element, startHeight, endHeight) {
    var self = this;

    // pin the 35% line (so the page doesn't "shoot")
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var anchorDocYBefore = (window.pageYOffset || document.documentElement.scrollTop || 0)
                         + vh * ViewportAnchorFraction + OpenOffsetPx;

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

      // restore the 35%+offset line after layout settles, then drain queued actions
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var anchorDocYAfter =
            (window.pageYOffset || document.documentElement.scrollTop || 0) +
            (window.innerHeight || document.documentElement.clientHeight) * ViewportAnchorFraction +
            OpenOffsetPx;

          var delta = anchorDocYAfter - anchorDocYBefore;
          if (Math.abs(delta) > 0.5) window.scrollBy(0, -delta);

          self._drainQueue(); // ✅ run whatever was queued
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

  // --- Auto-advance video drawers (safe: only if playback truly started) ---
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

      self._suppressIOUntil = self._now() + 600;

      if (nextId) {
        self.OpenThenCloseAndScroll(nextId, drawerId);
      } else {
        self.CloseAndLock(drawer);
      }
    }, { passive:true });
  };

  // ---------- Auto open on scroll (bidirectional) ----------
  DrawerController.prototype.EnableScrollAutoToggle = function () {
  var self = this;

  // === Helpers ===
  function currentIndex(){
    // first open wins; if none open, logical “-1” so first step opens 0
    for (var i = 0; i < self._drawers.length; i++){
      if (self._drawers[i].classList.contains("Drawer--Open")) return i;
    }
    return -1;
  }

  function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

  function openAtIndex(nextIndex){
    nextIndex = clamp(nextIndex, 0, self._drawers.length - 1);
    var d = self._drawers[nextIndex];
    if (!d) return;

    // step action: open the one drawer, close others, scroll it into position
    self.OpenDrawer(d);
    if (self._isAnimating){
      self._enqueue(function(){ self.CloseSiblings(d); });
    } else {
      self.CloseSiblings(d);
    }
    self.ScrollToDrawer(d.id);

    // gate further input for a tick so momentum doesn’t cascade
    self.ResetAccumulatedInput();
    self.FreezeInput(700);
    self._suppressIOUntil = self._now() + 300;
  }

  function maybeStep(){
    if (self._isFrozen() || self._isAnimating) return;

    var thr = self._threshold();
    var val = self._accumulatedSigned;

    if (val >= thr){
      // step DOWN
      var idx = currentIndex();
      openAtIndex(idx + 1);
    } else if (val <= -thr){
      // step UP
      var idx2 = currentIndex();
      // if nothing open yet (-1), stepping up means open first (0)
      openAtIndex(idx2 < 0 ? 0 : idx2 - 1);
    }
  }

  // === Input listeners (wheel/touch/key) ===
  function onWheel(e){
    if (self._blockScroll || self._isFrozen()){
      try { e.preventDefault(); } catch(_) {}
      return;
    }
    var dy = e.deltaY || 0;
    self._accumulatedInput  += Math.abs(dy);
    self._accumulatedSigned += dy;
    maybeStep();
  }

  function onTouchStart(e){
    var t = e.touches && e.touches[0];
    self._touchStartY = t ? t.clientY : null;
  }

  function onTouchMove(e){
    if (self._blockScroll || self._isFrozen()){
      try { e.preventDefault(); } catch(_) {}
      return;
    }
    var t = e.touches && e.touches[0];
    if (t && self._touchStartY != null){
      var dy = self._touchStartY - t.clientY; // down = positive
      self._touchStartY = t.clientY;

      self._accumulatedInput  += Math.abs(dy);
      self._accumulatedSigned += dy;
      maybeStep();
    }
  }

  function onKeyDown(e){
    // Only intercept keys that normally scroll
    var k = e.key || "";
    var scrollKeys = ["PageDown","PageUp","Home","End"," ","ArrowDown","ArrowUp"];
    if (self._blockScroll || self._isFrozen()){
      if (scrollKeys.indexOf(k) >= 0){
        try { e.preventDefault(); } catch(_) {}
      }
      return;
    }
    var step = 120; // emulate approx wheel delta for keys

    if (k === "ArrowDown" || k === "PageDown" || k === " "){
      self._accumulatedInput  += Math.abs(step);
      self._accumulatedSigned += step;
      maybeStep();
      try { e.preventDefault(); } catch(_) {}
    }
    if (k === "ArrowUp" || k === "PageUp"){
      self._accumulatedInput  += Math.abs(step);
      self._accumulatedSigned -= step;
      maybeStep();
      try { e.preventDefault(); } catch(_) {}
    }
    if (k === "Home"){
      // jump intent: force up step
      self._accumulatedInput  += Math.abs(step * 2);
      self._accumulatedSigned -= step * 2;
      maybeStep();
      try { e.preventDefault(); } catch(_) {}
    }
    if (k === "End"){
      // jump intent: force down step
      self._accumulatedInput  += Math.abs(step * 2);
      self._accumulatedSigned += step * 2;
      maybeStep();
      try { e.preventDefault(); } catch(_) {}
    }
  }

  // IMPORTANT: wheel/touchmove must be non-passive to allow preventDefault
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("keydown", onKeyDown, { passive: false });

  // Still track direction (useful for TabBar highlight, etc.)
  function onScroll(){
    var y = window.pageYOffset || 0;
    self._scrollDirection = (y > self._lastScrollY) ? 1 : (y < self._lastScrollY) ? -1 : self._scrollDirection;
    self._lastScrollY = y;
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
};
  DrawerController.prototype._OnIntersections = function (entries) {
    var now = this._now();
    // If we're in a freeze window, ignore IO entirely
    if (this._isFrozen()) return;
    if (this._booting || now < this._suppressIOUntil) return;

    // HARD MUTEX: if we're animating, ignore IO entirely
    if (this._isAnimating) return;

    // chronological
    entries.sort(function (a, b) { return a.time - b.time; });

    var anchorY = (window.innerHeight || document.documentElement.clientHeight) * ViewportAnchorFraction + OpenOffsetPx;

    for (var idx = 0; idx < entries.length; idx++) {
      var entry = entries[idx];
      if (!entry.isIntersecting) continue; // entering the slice only

      var target = entry.target;
      var drawer = target.closest && target.closest("[data-drawer]");
      if (!drawer) continue;

      var lockedUntil = parseFloat(drawer.dataset.lockedUntil || "0");
      if (lockedUntil > now) continue;

      var rectTop = target.getBoundingClientRect().top;

      if (this._scrollDirection === 1) {
        // DOWNWARD: open when the title crosses the anchor (below threshold)
        if (target.hasAttribute("data-drawer-summary")) {
          if (rectTop <= anchorY && !drawer.classList.contains("Drawer--Open")) {

            // Distance detent: require fresh user input
            if (this._accumulatedInput < this._threshold()) continue;

            // 🔒 stop chain reactions while we animate/snap
            this._isAnimating = true;

            this.OpenDrawer(drawer);
            this.ResetAccumulatedInput();
            this.FreezeInput(600);

            // Snap the page so this drawer header sits just under the TabBar
            var snapY = drawer.getBoundingClientRect().top + window.pageYOffset - 56; // TabBar height
            window.scrollTo({ top: snapY, behavior: "auto" });

            if (OnlyOneOpenAtATime) {
              this.CloseSiblings(drawer);
            }

            // brief suppression so the open-induced layout shift doesn't chain-trigger
            this._suppressIOUntil = this._now() + 300;

            // release the animate lock shortly after the CSS transition
            var self = this;
            setTimeout(function(){ self._isAnimating = false; }, AnimationDurationMs + 60);

            break; // ✅ handle only one drawer per observer batch
          }
        }
      } else if (this._scrollDirection === -1) {
        // UPWARD: open when the close-marker crosses the anchor from below
        if (target.hasAttribute("data-close-marker")) {
          if (rectTop >= anchorY && !drawer.classList.contains("Drawer--Open")) {

            if (this._accumulatedInput < this._threshold()) continue;

            // 🔒 stop chain reactions while we animate/snap
            this._isAnimating = true;

            this.OpenDrawer(drawer);
            this.ResetAccumulatedInput();
            this.FreezeInput(600);

            // Snap to keep this drawer header under the TabBar
            var snapYUp = drawer.getBoundingClientRect().top + window.pageYOffset - 56;
            window.scrollTo({ top: snapYUp, behavior: "auto" });

            if (OnlyOneOpenAtATime) {
              this.CloseSiblings(drawer);
            }

            this._suppressIOUntil = this._now() + 300;

            var self2 = this;
            setTimeout(function(){ self2._isAnimating = false; }, AnimationDurationMs + 60);

            break; // ✅ handle only one drawer per observer batch
          }
        }
      }
    }
  };

  DrawerController.prototype._FindAncestorDrawer = function (node) {
    while (node && node !== document) {
      if (node.hasAttribute && node.hasAttribute("data-drawer")) return node;
      node = node.parentNode;
    }
    return null;
  };

  // ---------- Public helpers ----------

  DrawerController.prototype.OpenById = function (id) {
    // Queue programmatic opens during animation
    if (this._isAnimating) {
      var self = this;
      this._enqueue(function(){ self.OpenById(id); });
      return;
    }

    var drawer = document.getElementById(id);
    if (!drawer) return;
    if (!drawer.classList.contains("Drawer--Open")) {
      this.OpenDrawer(drawer);
      // Suppress IO to avoid chain-opening via layout shift
      this._suppressIOUntil = this._now() + 450;
      // Also freeze input briefly to absorb momentum
      this.FreezeInput(450);

      if (OnlyOneOpenAtATime) {
        var self2 = this;
        if (this._isAnimating) {
          this._enqueue(function(){ self2.CloseSiblings(drawer); });
        } else {
          this.CloseSiblings(drawer);
        }
      }
    }
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
    var y = title.getBoundingClientRect().top + window.pageYOffset - 16;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  DrawerController.prototype.OpenThenCloseAndScroll = function (openId, closeId) {
    if (closeId) this.CloseById(closeId);
    this.OpenById(openId);
    this.ScrollToDrawer(openId);
  };

  // ---------- Boot ----------

  function InitializeDrawersWhenReady() {
    document.documentElement.style.setProperty(
      "--ViewportAnchorTriggerLinePositionVh",
      (ViewportAnchorFraction * 100) + "vh"
    );

    // visual guide line (optional)
    var guide = document.createElement("div");
    guide.className = "TriggerLine";
    document.body.appendChild(guide);

    var instance = new DrawerController(document);
    window.DrawersController = instance;

    // Open Intro once layout settles (and keep IO quiet while we do it)
    function openIntro() {
      var intro = document.getElementById("Intro");
      if (!intro) { instance._booting = false; return; }

      // Safe auto-advance: Intro -> About
      instance._wireAutoAdvanceVideo("Intro", "About");
      // instance._wireAutoAdvanceVideo("Tour", "Capabilities");

      instance._suppressIOUntil = instance._now() + SuppressIOAfterBootMs;
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

      setTimeout(function () { instance._booting = false; }, SuppressIOAfterBootMs);
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