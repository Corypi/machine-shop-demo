// Drawers.js (final patch)
// Fix: keep Intro OPEN on page load and autoplay the video, without snapping.
// We now open the Intro drawer directly and defensively ensure it's visible,
// instead of relying only on OpenById. All other behaviors remain unchanged.

(function () {
  "use strict";

  // ==========================================================
  // SnapManager
  // Single, reliable snapping primitive used everywhere.
  // ==========================================================
  var SnapManager = (function(){
    var MaxWaitMs = 500;
    var ConsecutiveStableFrames = 2;

    function _tabBar(){ return document.getElementById("TabBar"); }
    function _container(){ return document.querySelector(".Container"); }
    function _titleOf(drawer){ return drawer.querySelector("[data-drawer-summary]") || drawer; }

    function _barBottom(){
      var bar = _tabBar();
      return bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
    }

    function UpdateTabBarOffsetVar(){
      var px = _barBottom();
      document.documentElement.style.setProperty("--TabBarOffsetPixels", px + "px");
    }

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

    function SnapToTitle(drawer, behavior){
      if (!drawer) return;
      var title = _titleOf(drawer);
      title.scrollIntoView({ block: "start", inline: "nearest", behavior: behavior || "auto" });
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
  var SuppressMsAfterProgrammaticClose = 250;

  function DrawerController(root) {
    this._root        = root;
    this._isAnimating = false;

    this._drawers   = null;
    this._summaries = null;

    this._queue = [];
    this._enqueue = function (fn) { if (typeof fn === "function") this._queue.push(fn); };
    this._drainQueue = function () {
      if (this._isAnimating) return;
      while (this._queue.length) {
        var fn = this._queue.shift();
        try { fn(); } catch (e) {}
        if (this._isAnimating) break;
      }
    };

    this._now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };

    this.Initialize();
  }

  // ---------- Helpers: hero + TabBar + Tab-Mode visibility ----------

  DrawerController.prototype._heroId = function(){
    if (!this._drawers || !this._drawers.length) return null;
    return this._drawers[0] && this._drawers[0].id ? this._drawers[0].id : null;
  };

  DrawerController.prototype._tabBarEl = function(){ return document.getElementById("TabBar"); };
  DrawerController.prototype._isTabMode = function(){ return document.body.classList.contains("Tabs--Visible"); };

  // In tab mode, hide only drawers BEFORE the active index.
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
      SnapManager.UpdateTabBarOffsetVar();
    }
  };

  DrawerController.prototype._forceRemoveFromFlow = function(drawer){
    if (!drawer) return;
    try {
      var vids = drawer.querySelectorAll("video");
      for (var i = 0; i < vids.length; i++) { vids[i].pause(); }
    } catch(_) {}
    var content = drawer.querySelector("[data-drawer-content]");
    if (content){ content.style.transition = ""; content.style.height = ""; }
    this.SetAriaExpanded(drawer, false);
    drawer.classList.remove("Drawer--Open", "Drawer--NoTail");
    drawer.setAttribute("hidden", "");
    drawer.style.display = "none";
    void document.body.offsetHeight;
    document.dispatchEvent(new CustomEvent("hero:collapsed", { detail: { id: drawer.id }}));
  };

  // ===================================================

  DrawerController.prototype.Initialize = function () {
    this._drawers   = this._root.querySelectorAll("[data-drawer]");
    this._summaries = this._root.querySelectorAll("[data-drawer-summary]");

    for (var j = 0; j < this._drawers.length; j++) {
      var d = this._drawers[j];
      d.classList.remove("Drawer--Open", "Drawer--NoTail");
      d.removeAttribute("hidden");
      d.style.display = "";
      var c = d.querySelector("[data-drawer-content]");
      if (c) c.style.height = "";
    }

    for (var i = 0; i < this._summaries.length; i++) {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    this.SyncAria();
    this.SyncHeights();

    window.addEventListener("resize", function(){ SnapManager.UpdateTabBarOffsetVar(); }, { passive: true });

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
      this._enqueue(function () { self.OnToggleRequested({ currentTarget: target, key: "queued" }); });
      return;
    }

    var summary = evt.currentTarget;
    var drawer  = summary.closest ? summary.closest("[data-drawer]") : this._FindAncestorDrawer(summary);
    if (!drawer) return;

    var heroId = this._heroId();

    if (drawer.classList.contains("Drawer--Open")) {
      this.CloseAndLock(drawer);
    } else {
      drawer.style.display = "";

      if (heroId && drawer.id !== heroId) {
        var hero = document.getElementById(heroId);
        if (hero && hero.style.display !== "none") { this._forceRemoveFromFlow(hero); }
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

      SnapManager.UpdateTabBarOffsetVar();
      var self3 = this;
      SnapManager.WaitStable(function(){ self3.ScrollToDrawer(drawer.id); });
    }
  };

  // ---------- Programmatic open/close ----------

  DrawerController.prototype.OpenDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    if (content.classList.contains("DrawerContent--Fill")) { drawer.classList.add("Drawer--NoTail"); }
    else { drawer.classList.remove("Drawer--NoTail"); }

    var startHeight = content.getBoundingClientRect().height | 0;
    content.style.height = Math.max(0, startHeight) + "px";

    drawer.classList.add("Drawer--Open");
    this.SetAriaExpanded(drawer, true);

    document.dispatchEvent(new CustomEvent("drawer:opened", { detail: { id: drawer.id }}));

    var self = this;

    function measureEndHeight() {
      var prevH = content.style.height;
      var prevT = content.style.transition;
      content.style.transition = "";
      content.style.height = "";
      void content.offsetHeight;

      var end = content.getBoundingClientRect().height;
      if (!end || end < 1) { end = content.scrollHeight; }

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

    var heroIdNow = this._heroId();
    if (heroIdNow && drawer.id === heroIdNow) {
      this._forceRemoveFromFlow(drawer);
      this._ensureTabBarVisible();
    }

    document.dispatchEvent(new CustomEvent("drawer:closed", { detail: { id: drawer.id }}));

    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) { try { vids[i].pause(); vids[i].currentTime = 0; } catch (e) {} }

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

  // In tab mode, only hide drawers BEFORE the active index.
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

      if (d.classList.contains("Drawer--Open")) { this.CloseDrawer(d); }

      if (removeHero && heroId && d.id === heroId) {
        if (d.style.display !== "none" || !d.hasAttribute("hidden")) { this._forceRemoveFromFlow(d); }
        continue;
      }

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

      if (endHeight > 0) { element.style.height = useCssClamp ? "" : "auto"; }
      else { element.style.height = ""; }

      self._isAnimating = false;

      requestAnimationFrame(function () {
        requestAnimationFrame(function () { self._drainQueue(); });
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
        if (content.classList.contains("DrawerContent--Fill")) { drawer.classList.add("Drawer--NoTail"); }
        else { drawer.classList.remove("Drawer--NoTail"); }

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

  // ---------- Public helpers ----------

  DrawerController.prototype._FindAncestorDrawer = function (node) {
    while (node && node !== document) {
      if (node.hasAttribute && node.hasAttribute("data-drawer")) return node;
      node = node.parentNode;
    }
    return null;
  };

  // UPDATED SIGNATURE: OpenById(id, opts?)
  // opts.snap: whether to perform a snap after opening (default true)
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
      if (hero && hero.style.display !== "none") { this._forceRemoveFromFlow(hero); }
      this._ensureTabBarVisible();
    }

    drawer.removeAttribute("hidden");
    drawer.style.display = "";
    if (!drawer.classList.contains("Drawer--Open")) {
      this.OpenDrawer(drawer);

      if (OnlyOneOpenAtATime) {
        var self2 = this;
        if (this._isAnimating) { this._enqueue(function(){ self2.CloseSiblings(drawer, /*removeHero*/true); }); }
        else { self2.CloseSiblings(drawer, /*removeHero*/true); }
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

  DrawerController.prototype.ScrollToDrawer = function (id) {
    var el = typeof id === "string" ? document.getElementById(id) : id;
    if (!el) return;
    SnapManager.WaitStable(function(){ SnapManager.SnapToTitle(el, "auto"); });
  };

  // When orchestrating open+snap (e.g., from TabBar), we suppress the internal snap in OpenById
  // and do a single snap after we receive "drawer:opened".
  DrawerController.prototype.OpenThenCloseAndScroll = function (openId, closeId) {
    var self = this;
    var heroId = this._heroId();

    function openAndSnap() {
      self.OpenById(openId, { snap: false }); // <-- suppress snap here

      function onOpened(e){
        if (!e || !e.detail || e.detail.id !== openId) return;
        document.removeEventListener("drawer:opened", onOpened);
        SnapManager.UpdateTabBarOffsetVar();
        SnapManager.WaitStable(function(){ self.ScrollToDrawer(openId); });
      }
      document.addEventListener("drawer:opened", onOpened);
    }

    if (closeId && heroId && closeId === heroId) {
      var hero = document.getElementById(closeId);
      if (hero && hero.style.display !== "none") { this._forceRemoveFromFlow(hero); }
      this._ensureTabBarVisible();
      SnapManager.UpdateTabBarOffsetVar();
      requestAnimationFrame(openAndSnap);
      return;
    }

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

      // DEFENSIVELY ensure Intro is visible and OPEN on first paint
      intro.removeAttribute("hidden");
      intro.style.display = "";
      if (!intro.classList.contains("Drawer--Open")) {
        // Open directly (no snap on page-load)
        instance.OpenDrawer(intro);
      }

      instance._wireAutoAdvanceVideo("Intro", "About");

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

    // Open Intro ASAP after DOM is ready
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