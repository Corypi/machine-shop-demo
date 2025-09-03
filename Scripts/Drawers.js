// Drawers.js — Complete drop-in file
// - Unified SnapManager for reliable snapping under TabBar via CSS scroll-margin-top
// - Tab-mode visibility: when TabBar is visible, hide drawers *before* the active one
// - Autoplay videos reliably on FIRST open: load()+play() after the drawer is fully laid out
// - Intro stays open on first load (no snap), autoplays; skipping shows TabBar and snaps correctly

(function () {
  "use strict";

  // ==========================================================
  // SnapManager
  // Single, boringly-reliable snapping primitive used everywhere.
  // Relies on CSS `scroll-margin-top: var(--TabBarOffsetPixels)` set
  // on drawer titles (see CSS). We only:
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

  DrawerController.prototype._tabBarEl = function(){ return document.getElementById("TabBar"); };
  DrawerController.prototype._isTabMode = function(){ return document.body.classList.contains("Tabs--Visible"); };

  // In tab mode, hide drawers BEFORE the active one; show the active and those after it.
  DrawerController.prototype._applyTabModeVisibility = function(activeId){
    var inTabMode = this._isTabMode();
    if (!inTabMode){
      for (var k = 0; k < this._drawers.length; k++){
        this._drawers[k].removeAttribute("hidden");
        this._drawers[k].style.display = "";
      }
      return;
    }

    var activeIdx = -1;
    for (var i = 0; i < this._drawers.length; i++){
      if (this._drawers[i].id === activeId){ activeIdx = i; break; }
    }
    if (activeIdx < 0){
      for (var j = 0; j < this._drawers.length; j++){
        this._drawers[j].removeAttribute("hidden");
        this._drawers[j].style.display = "";
      }
      return;
    }

    for (var n = 0; n < this._drawers.length; n++){
      var d = this._drawers[n];
      if (n < activeIdx){
        d.setAttribute("hidden", "");
        d.style.display = "none";
      } else {
        d.removeAttribute("hidden");
        d.style.display = "";
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

    // Keep tab-mode visibility in sync with the active drawer
    var self = this;
    document.addEventListener("drawer:opened", function(e){
      if (e && e.detail && e.detail.id){ self._applyTabModeVisibility(e.detail.id); }
    });

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

      // Unified, robust snap: wait for a stable layout, then scroll to title.
      var self3 = this;
      SnapManager.UpdateTabBarOffsetVar();
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

    // 🔔 notify observers (opened state toggled)
    document.dispatchEvent(new CustomEvent("drawer:opened", { detail: { id: drawer.id }}));

    // First-chance autoplay try (safe; we'll retry after animation too)
    this._autoplayVideos(drawer);

    var self = this;

    function dispatchOpenComplete(){
      // After animation fully settles:
      document.dispatchEvent(new CustomEvent("drawer:open-complete", { detail: { id: drawer.id }}));
      // ✅ Final-chance: ensure videos play when drawer is laid out & visible
      self._ensureVideoPlayback(drawer);
    }

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
        dispatchOpenComplete();
        return;
      }

      self.AnimateHeight(content, startHeight, endHeight, dispatchOpenComplete);
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

  DrawerController.prototype.CloseSiblings = function (exceptDrawer, removeHero) {
    var heroId = this._heroId();
    var inTabMode = this._isTabMode();

    var activeIdx = -1;
    for (var x = 0; x < this._drawers.length; x++){
      if (this._drawers[x] === exceptDrawer){ activeIdx = x; break; }
    }

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

      // 3) visibility rules in tab mode
      if (inTabMode){
        if (i < activeIdx){ d.setAttribute("hidden", ""); d.style.display = "none"; }
        else { d.removeAttribute("hidden"); d.style.display = ""; }
      } else {
        d.removeAttribute("hidden");
        d.style.display = "";
      }
    }
  };

  // ---------- Animation + ARIA ----------

  DrawerController.prototype.AnimateHeight = function (element, startHeight, endHeight, onComplete) {
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
          if (typeof onComplete === "function") { onComplete(); }
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

  // ===================================================
  // Video helpers: robust first-open autoplay
  // ===================================================
  DrawerController.prototype._autoplayVideos = function(drawer){
    if (!drawer) return;
    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++){
      (function(video){
        // Ensure permissive attributes before any play()
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute("playsinline","");
        // No controls for hero/tour UX
        video.removeAttribute("controls");

        // Nudge buffering if needed
        try {
          if (video.networkState === 0 || video.networkState === 1) {
            video.load();
          }
        } catch(_) {}

        function tryPlay(){
          try {
            var p = video.play();
            if (p && typeof p.catch === "function"){ p.catch(function(){}); }
          } catch(_) {}
        }

        // Immediate attempt + event-based retries + small timeout retry
        tryPlay();
        var onMeta = function(){ video.removeEventListener("loadedmetadata", onMeta); tryPlay(); };
        var onCanPlay = function(){ video.removeEventListener("canplay", onCanPlay); tryPlay(); };
        var onCanPlayThrough = function(){ video.removeEventListener("canplaythrough", onCanPlayThrough); tryPlay(); };
        video.addEventListener("loadedmetadata", onMeta, { passive: true });
        video.addEventListener("canplay", onCanPlay, { passive: true });
        video.addEventListener("canplaythrough", onCanPlayThrough, { passive: true });
        setTimeout(tryPlay, 120);
      })(vids[i]);
    }
  };

  DrawerController.prototype._ensureVideoPlayback = function(drawer){
    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++){
      var v = vids[i];
      try {
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;
        v.load(); // reset so first-open is fresh
        var p = v.play();
        if (p && typeof p.catch === "function") { p.catch(function(){}); }
      } catch(e){}
    }
  };

  // --- Optional: auto-advance a video drawer ---
  // --- Auto-advance a video drawer, with optional soft-trim cutoff ---
DrawerController.prototype._wireAutoAdvanceVideo = function (drawerId, nextId, options) {
  var cutoffSeconds = options && typeof options.cutoffSeconds === "number" ? Math.max(0, options.cutoffSeconds) : null;

  var drawer = document.getElementById(drawerId);
  if (!drawer) return;
  var content = drawer.querySelector("[data-drawer-content]");
  var video   = content ? content.querySelector("video") : null;
  if (!video) return;

  var self = this;
  var started = false;
  var cleaned = false;

  function tryPlay() {
    try {
      video.muted = true;
      video.playsInline = true;
      var p = video.play();
      if (p && typeof p.catch === "function") p.catch(function(){});
    } catch(e) {}
  }

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("loadedmetadata", onLoadedMeta);
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.removeEventListener("ended", onEnded);
  }

  function advanceIfVisible() {
    // Only advance if the source drawer is still open (user might have clicked elsewhere)
    if (!drawer.classList.contains("Drawer--Open")) return;
    cleanup();
    if (nextId) {
      self.OpenThenCloseAndScroll(nextId, drawerId);
    } else {
      self.CloseAndLock(drawer);
    }
  }

  function onPlaying(){ started = true; }
  function onLoadedMeta(){
    // If we have a cutoff beyond the actual duration, clamp it
    if (cutoffSeconds != null && isFinite(video.duration) && video.duration > 0) {
      cutoffSeconds = Math.min(cutoffSeconds, video.duration);
    }
    tryPlay();
  }

  function onTimeUpdate(){
    if (cutoffSeconds == null) return;
    if (video.currentTime >= cutoffSeconds) {
      try { video.pause(); } catch(_) {}
      advanceIfVisible();
    }
  }

  function onEnded(){
    if (!started) return;
    // If we didn’t soft-trim, use the natural ended event
    if (cutoffSeconds == null) {
      advanceIfVisible();
    }
  }

  video.addEventListener("playing", onPlaying, { passive:true });
  video.addEventListener("loadedmetadata", onLoadedMeta, { passive:true });
  video.addEventListener("timeupdate", onTimeUpdate, { passive:true });
  video.addEventListener("ended", onEnded, { passive:true });

  // Kick things off in case metadata is already available
  if (video.readyState >= 1) { onLoadedMeta(); } else { tryPlay(); }
};

  // ---------- Public helpers ----------

function PrimeMarkedVideos(){
  var vids = document.querySelectorAll('video[data-prime="true"]');
  for (var i = 0; i < vids.length; i++){
    var v = vids[i];
    try {
      // Make sure policies are friendly to preloading
      v.muted = true;
      v.playsInline = true;
      // Ensure eager behavior is active
      v.preload = "auto";
      // Kick the network pipeline
      v.load();
    } catch(_) {}
  }
}

  DrawerController.prototype._FindAncestorDrawer = function (node) {
    while (node && node !== document) {
      if (node.hasAttribute && node.hasAttribute("data-drawer")) return node;
      node = node.parentNode;
    }
    return null;
  };

  // UPDATED SIGNATURE: OpenById(id, opts?) — opts.snap (default true)
  DrawerController.prototype.OpenById = function (id, opts) {
    var snap = !opts || opts.snap !== false;

    if (this._isAnimating) {
      var self = this;
      this._enqueue(function(){ self.OpenById(id, opts); });
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

    if (snap){
      SnapManager.UpdateTabBarOffsetVar();
      var self3 = this;
      SnapManager.WaitStable(function(){ self3.ScrollToDrawer(id); });
    }
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
      // open without immediate snap; we'll snap on open-complete
      self.OpenById(openId, { snap: false });

      function onOpenComplete(e){
        if (!e || !e.detail || e.detail.id !== openId) return;
        document.removeEventListener("drawer:open-complete", onOpenComplete);
        SnapManager.UpdateTabBarOffsetVar();
        SnapManager.WaitStable(function(){
          self.ScrollToDrawer(openId);
        });
      }
      document.addEventListener("drawer:open-complete", onOpenComplete);
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
    
    PrimeMarkedVideos();

    function openIntro() {
      var intro = document.getElementById("Intro");
      if (!intro) return;

      // Keep Intro open on first load (no snap) and autoplay video
      intro.removeAttribute("hidden");
      intro.style.display = "";
      if (!intro.classList.contains("Drawer--Open")) {
        instance.OpenDrawer(intro);
      }

      // Wire auto-advance for the intro video to "About"
      // Auto-advance from Intro to Tour after ~25s (even if the file is longer)
instance._wireAutoAdvanceVideo("Intro", "Tour", { cutoffSeconds: 20 });

      // Initial autoplay safety pass (in case readyState is already good)
      instance._autoplayVideos(intro);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function(){
        requestAnimationFrame(function(){ requestAnimationFrame(openIntro); });
      }, { once: true });
    } else {
      requestAnimationFrame(function(){ requestAnimationFrame(openIntro); });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeDrawersWhenReady);
  } else {
    InitializeDrawersWhenReady();
  }

  window.DrawerController = DrawerController;
})();