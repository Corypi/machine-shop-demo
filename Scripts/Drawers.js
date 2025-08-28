(function () {
  "use strict";

  // ===== Configuration (no magic numbers) =====
  var AnimationDurationMs = 220;
  var OnlyOneOpenAtATime = true;

  // Auto open/close on scroll
  var AutoOpenOnScroll = true;
  var ViewportAnchorFraction = 0.35; // 0.5 = center; 0.35 opens a bit before center

  // Debounce auto-open so it triggers after scrolling pauses
  var PauseAutoOpenWhileScrolling = true;
  var ScrollIdleMs = 120;

  // NEW: anti-flap controls
  var SuppressMsAfterProgrammaticClose = 700; // time window where a just-closed drawer won't re-open
  var HysteresisPx = 64; // when near the anchor, prefer the drawer in the direction of travel by this bias

  // ============================================

  function DrawerController(root) {
    this._root = root;
    this._isAnimating = false;

    this._drawers = null;
    this._summaries = null;

    this._observer = null;
    this._scrollRafPending = false;

    // Debounce state
    this._scrollIdleTimerId = null;
    this._isScrollIdle = true;

    // Scroll direction + suppression
    this._lastScrollY = window.pageYOffset || 0;
    this._now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };

    this.Initialize();
  }

  DrawerController.prototype.Initialize = function () {
    this._drawers = this._root.querySelectorAll("[data-drawer]");
    this._summaries = this._root.querySelectorAll("[data-drawer-summary]");

    for (var i = 0; i < this._summaries.length; i++) {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    // Ensure only Intro is open by default (leave any .Drawer--Open in HTML alone)
    for (var j = 0; j < this._drawers.length; j++) {
      var d = this._drawers[j];
      if (d.id !== "Intro") d.classList.remove("Drawer--Open");
    }

    this.SyncAria();
    this.SyncHeights();

    if (AutoOpenOnScroll) {
      this.EnableScrollAutoToggle();
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
    if (this._isAnimating) return;

    var summary = evt.currentTarget;
    var drawer = summary.closest ? summary.closest("[data-drawer]") : this._FindAncestorDrawer(summary);
    if (!drawer) return;

    var isOpen = drawer.classList.contains("Drawer--Open");
    if (isOpen) {
      this.CloseAndLock(drawer); // user-triggered close: lock briefly to avoid re-open flap
    } else {
      this.OpenDrawer(drawer);
      if (OnlyOneOpenAtATime) this.CloseSiblings(drawer);
    }
  };

  // ---------- Programmatic open/close ----------

  DrawerController.prototype.OpenDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.add("Drawer--Open");
    this.SetAriaExpanded(drawer, true);

    var endHeight = content.scrollHeight;
    this.AnimateHeight(content, startHeight, endHeight);
  };

  DrawerController.prototype.CloseDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.remove("Drawer--Open");
    this.SetAriaExpanded(drawer, false);

    // Pause/rewind any videos inside this drawer
    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      try {
        vids[i].pause();
        // If you prefer not to rewind, remove the next line
        vids[i].currentTime = 0;
      } catch (e) {}
    }

    var endHeight = 0;
    this.AnimateHeight(content, startHeight, endHeight);
  };

  // Close + lockout to prevent immediate auto-reopen
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

    if (this._isAnimating) {
      element.style.transition = "";
      element.style.height = endHeight > 0 ? (endHeight + "px") : "";
    }

    this._isAnimating = true;

    element.style.height = Math.max(0, startHeight) + "px";
    void element.offsetHeight;

    element.style.transition = "height " + AnimationDurationMs + "ms ease";
    element.style.height = Math.max(0, endHeight) + "px";

    function OnTransitionEnd(e) {
      if (e.propertyName === "height") {
        element.style.transition = "";
        if (endHeight === 0) {
          element.style.height = "";
        } else {
          element.style.height = endHeight + "px";
        }
        element.removeEventListener("transitionend", OnTransitionEnd);
        self._isAnimating = false;
      }
    }

    element.addEventListener("transitionend", OnTransitionEnd);
  };

  DrawerController.prototype.SyncAria = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var drawer = this._drawers[i];
      var summary = drawer.querySelector("[data-drawer-summary]");
      if (!summary) continue;
      var isOpen = drawer.classList.contains("Drawer--Open");
      summary.setAttribute("aria-expanded", isOpen ? "true" : "false");
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
        content.style.height = content.scrollHeight + "px";
      } else {
        content.style.height = "";
      }
    }
  };

  // ---------- Auto open/close on scroll ----------

  DrawerController.prototype.EnableScrollAutoToggle = function () {
    var self = this;

    if ("IntersectionObserver" in window) {
      var options = { root: null, rootMargin: "0px", threshold: this._BuildThresholds() };
      this._observer = new IntersectionObserver(function () { self.OnScroll(); }, options);
      for (var i = 0; i < this._summaries.length; i++) this._observer.observe(this._summaries[i]);
    }

    if (PauseAutoOpenWhileScrolling) {
      window.addEventListener("scroll", function () {
        self._isScrollIdle = false;
        if (self._scrollIdleTimerId) clearTimeout(self._scrollIdleTimerId);
        self._scrollIdleTimerId = setTimeout(function () {
          self._isScrollIdle = true;
          self.OnScroll(); // once when scrolling settles
        }, ScrollIdleMs);
      }, { passive: true });

      window.addEventListener("resize", function () {
        self._isScrollIdle = true;
        self.OnScroll();
      });
    } else {
      window.addEventListener("scroll", this.OnScroll.bind(this), { passive: true });
      window.addEventListener("resize", this.OnScroll.bind(this));
    }

    this.OnScroll();
  };

  DrawerController.prototype._BuildThresholds = function () {
    var thresholds = [];
    for (var i = 0; i <= 20; i++) thresholds.push(i / 20);
    return thresholds;
  };

  DrawerController.prototype.OnScroll = function () {
    var self = this;

    if (PauseAutoOpenWhileScrolling && !this._isScrollIdle) return;
    if (this._scrollRafPending) return;

    this._scrollRafPending = true;

    window.requestAnimationFrame(function () {
      self._scrollRafPending = false;
      self.OpenClosestToViewportAnchor();
      self._lastScrollY = window.pageYOffset || 0;
    });
  };

  DrawerController.prototype.OpenClosestToViewportAnchor = function () {
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    var anchorY = viewportHeight * ViewportAnchorFraction;

    var scrollingDown = (window.pageYOffset || 0) > this._lastScrollY;

    var bestDrawer = null;
    var bestScore = Number.POSITIVE_INFINITY;
    var now = this._now();

    for (var i = 0; i < this._drawers.length; i++) {
      var drawer = this._drawers[i];

      // Skip drawers in their suppression window
      var lockedUntil = parseFloat(drawer.dataset.lockedUntil || "0");
      if (lockedUntil > now) continue;

      var summary = drawer.querySelector("[data-drawer-summary]");
      if (!summary) continue;

      var dy = summary.getBoundingClientRect().top - anchorY; // negative = above anchor, positive = below
      var base = Math.abs(dy);

      // Bias toward the drawer AHEAD of the scroll direction
      var penalty = 0;
      if (scrollingDown && dy < 0) penalty = HysteresisPx;        // it's behind you; penalize
      if (!scrollingDown && dy > 0) penalty = HysteresisPx;

      var score = base + penalty;

      if (score < bestScore) {
        bestScore = score;
        bestDrawer = drawer;
      }
    }

    if (!bestDrawer) return;

    var alreadyOpen = bestDrawer.classList.contains("Drawer--Open");
    if (!alreadyOpen) this.OpenDrawer(bestDrawer);

    if (OnlyOneOpenAtATime) this.CloseSiblings(bestDrawer);
  };

  // ---------- Public helpers ----------

  DrawerController.prototype.OpenById = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    if (!drawer.classList.contains("Drawer--Open")) {
      this.OpenDrawer(drawer);
      if (OnlyOneOpenAtATime) this.CloseSiblings(drawer);
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
    this.OpenById(openId);
    this.CloseById(closeId); // locked close prevents auto-reopen
    this.ScrollToDrawer(openId);
  };

  DrawerController.prototype._FindAncestorDrawer = function (node) {
    while (node && node !== document) {
      if (node.hasAttribute && node.hasAttribute("data-drawer")) return node;
      node = node.parentNode;
    }
    return null;
  };

  // ---------- Boot ----------

  function InitializeDrawersWhenReady() {
    // Sync CSS var so yellow guide matches the JS anchor
    document.documentElement.style.setProperty(
      "--ViewportAnchorTriggerLinePositionVh",
      (ViewportAnchorFraction * 100) + "vh"
    );

    // Optional: keep the visual guide (comment these 3 lines to hide)
    var guide = document.createElement("div");
    guide.className = "TriggerLine";
    document.body.appendChild(guide);

    var root = document;
    var instance = new DrawerController(root);
    window.DrawersController = instance;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeDrawersWhenReady);
  } else {
    InitializeDrawersWhenReady();
  }

  window.DrawerController = DrawerController;

})();