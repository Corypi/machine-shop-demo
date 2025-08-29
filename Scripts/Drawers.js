(function () {
  "use strict";

  // ===== Configuration (no magic numbers) =====
  var AnimationDurationMs = 220;
  var OnlyOneOpenAtATime = true;

  // Auto open/close on scroll via “virtual line”
  var AutoOpenOnScroll = true;
  var ViewportAnchorFraction = 0.35; // 35% from top

  // Do NOT pause while scrolling (IO needs to fire live)
  var PauseAutoOpenWhileScrolling = false;
  var ScrollIdleMs = 120; // kept for completeness

  // Anti-flap
  var SuppressMsAfterProgrammaticClose = 250;

  // State machine thresholds (tiny hysteresis so IO jitter can't flap)
  var OpenThresholdPx  = 8;   // when the 35% line passes a title by ≥ this, allow open
  var CloseThresholdPx = 8;   // when the 35% line passes a close-marker by ≥ this, allow close

  // IO at a virtual "line" = 35% from top
  var RootMarginForAnchor =
    (-(ViewportAnchorFraction * 100)).toFixed(3) + "% 0px " +
    (-(100 - ViewportAnchorFraction * 100)).toFixed(3) + "% 0px";

  // ============================================

  function DrawerController(root) {
    this._root = root;
    this._isAnimating = false;

    this._drawers = null;
    this._summaries = null;
    this._observer = null;

    // Direction tracking
    this._lastScrollY = window.pageYOffset || 0;

    // Finite state: index of the drawer we consider “active”
    this._activeIndex = 0; // will be set in Initialize()
    this._scrollDirection = 1; // seed as "down"

    this._now = function () {
      return (window.performance && performance.now) ? performance.now() : Date.now();
    };

    this.Initialize();
  }

  DrawerController.prototype.Initialize = function () {
    this._drawers = this._root.querySelectorAll("[data-drawer]");
    this._summaries = this._root.querySelectorAll("[data-drawer-summary]");

    for (var i = 0; i < this._summaries.length; i++) {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    // Leave only #Intro open if present
    for (var j = 0; j < this._drawers.length; j++) {
      var d = this._drawers[j];
      if (d.id !== "Intro") d.classList.remove("Drawer--Open");
    }

    // Ensure already-open drawers get the proper tail state
    this._applyNoTailForOpenDrawers();

    // Inject close markers at end of each content
    this._InstallCloseMarkers();

    this._ApplyNoTailOnFill();
    this.SyncAria();
    this.SyncHeights();

    // Set initial active index to the first open drawer (default Intro)
    this._activeIndex = this._findInitiallyOpenIndex();
    if (OnlyOneOpenAtATime) this._openOnly(this._activeIndex);

    if (AutoOpenOnScroll) this.EnableScrollAutoToggle();
  };

  DrawerController.prototype._applyNoTailForOpenDrawers = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      var c = d.querySelector("[data-drawer-content]");
      if (!c) continue;
      if (d.classList.contains("Drawer--Open") && c.classList.contains("DrawerContent--Fill")) {
        d.classList.add("Drawer--NoTail");
      } else {
        d.classList.remove("Drawer--NoTail");
      }
    }
  };

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

  // keep state in sync & enforce only-one-open
  DrawerController.prototype.OnToggleRequested = function (evt) {
    if (this._isAnimating) return;
    var summary = evt.currentTarget;
    var drawer = summary.closest ? summary.closest("[data-drawer]") : this._FindAncestorDrawer(summary);
    if (!drawer) return;

    var idx = this._indexOf(drawer);
    if (idx < 0) return;

    if (drawer.classList.contains("Drawer--Open")) {
      this.CloseAndLock(drawer);
      if (idx === this._activeIndex) this._activeIndex = this._prevIndex(idx);
    } else {
      if (OnlyOneOpenAtATime) this._openOnly(idx);
      else this.OpenDrawer(drawer);
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

  var startHeight = content.getBoundingClientRect().height;

  drawer.classList.add("Drawer--Open");
  this.SetAriaExpanded(drawer, true);

  // Let layout settle, then measure the *real* rendered height
  var self = this;
  requestAnimationFrame(function () {
    var endHeight = content.getBoundingClientRect().height;
    self.AnimateHeight(content, startHeight, endHeight);
  });

  // If there’s a video, re-sync once metadata gives us final dimensions
  var vid = content.querySelector("video");
  if (vid) {
    var onMeta = function () {
      // re-measure only if still open
      if (drawer.classList.contains("Drawer--Open")) {
        var h = content.getBoundingClientRect().height;
        content.style.height = h + "px";
      }
      vid.removeEventListener("loadedmetadata", onMeta);
    };
    vid.addEventListener("loadedmetadata", onMeta, { once: true });
  }
};

  DrawerController.prototype.CloseDrawer = function (drawer) {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content) return;

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.remove("Drawer--Open");
    drawer.classList.remove("Drawer--NoTail");
    this.SetAriaExpanded(drawer, false);

    // Pause/rewind any videos in this drawer
    var vids = drawer.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].pause(); vids[i].currentTime = 0; } catch (e) {}
    }

    var endHeight = 0;
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
        element.style.height = endHeight > 0 ? (endHeight + "px") : "";
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
        if (content.classList.contains("DrawerContent--Fill")) {
          drawer.classList.add("Drawer--NoTail");
        } else {
          drawer.classList.remove("Drawer--NoTail");
        }
        content.style.height = content.getBoundingClientRect().height + "px";
      } else {
        drawer.classList.remove("Drawer--NoTail");
        content.style.height = "";
      }
    }
  };

  // ---------- State helpers ----------

  DrawerController.prototype._findInitiallyOpenIndex = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      if (this._drawers[i].classList.contains("Drawer--Open")) return i;
    }
    return 0;
  };

  DrawerController.prototype._indexOf = function (drawer) {
    for (var i = 0; i < this._drawers.length; i++) if (this._drawers[i] === drawer) return i;
    return -1;
  };

  DrawerController.prototype._openOnly = function (idx) {
    if (idx < 0 || idx >= this._drawers.length) return;
    for (var i = 0; i < this._drawers.length; i++) {
      if (i === idx) {
        if (!this._drawers[i].classList.contains("Drawer--Open")) this.OpenDrawer(this._drawers[i]);
      } else {
        if (this._drawers[i].classList.contains("Drawer--Open")) this.CloseDrawer(this._drawers[i]);
      }
    }
    this._activeIndex = idx;
  };

  DrawerController.prototype._nextIndex = function (idx) {
    return (idx + 1 < this._drawers.length) ? idx + 1 : idx;
  };

  DrawerController.prototype._prevIndex = function (idx) {
    return (idx - 1 >= 0) ? idx - 1 : idx;
  };

  // ---------- Auto open/close on scroll via "line" (IO at 35%) ----------

  DrawerController.prototype.EnableScrollAutoToggle = function () {
    var self = this;

    // Observe at the virtual 35% line
    this._observer = new IntersectionObserver(function (entries) {
      self._OnIntersections(entries);
    }, {
      root: null,
      threshold: 0,
      rootMargin: RootMarginForAnchor
    });

    // Observe each open marker (summary) and each close marker (content end)
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      var summary = d.querySelector("[data-drawer-summary]");
      var closeMarker = d.querySelector("[data-close-marker]");
      if (summary) this._observer.observe(summary);
      if (closeMarker) this._observer.observe(closeMarker);
    }

    // Direction tracking only (no idle gating)
    function onScroll() {
      var y = window.pageYOffset || 0;
      self._scrollDirection = (y > self._lastScrollY) ? 1 : (y < self._lastScrollY) ? -1 : self._scrollDirection;
      self._lastScrollY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  };

  // Stable state-machine IO handler (down-only by design)
  DrawerController.prototype._OnIntersections = function (entries) {
    // process in chronological order
    entries.sort(function (a, b) { return a.time - b.time; });

    var now = this._now();
    var dir = this._scrollDirection || 1; // 1=down, -1=up
    if (dir !== 1) return; // unidirectional (down only)

    var anchorY = (window.innerHeight || document.documentElement.clientHeight) * (ViewportAnchorFraction || 0.35);

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.isIntersecting) continue; // only when entering the slice

      var target = entry.target;
      var drawer = target.closest("[data-drawer]");
      if (!drawer) continue;

      // respect lockout
      var lockedUntil = parseFloat(drawer.dataset.lockedUntil || "0");
      if (lockedUntil > now) continue;

      var idx = this._indexOf(drawer);
      if (idx < 0) continue;

      // Only allow transitions to the current active or its immediate next
      var canAdvanceDown = (idx === this._activeIndex || idx === this._activeIndex + 1);

      var rect = target.getBoundingClientRect();

      if (target.hasAttribute("data-drawer-summary")) {
        // title row; compare its bottom to the anchor with hysteresis
        if (!canAdvanceDown) continue;
        if ((rect.bottom - anchorY) >= OpenThresholdPx) {
          this._openOnly(idx);
          return; // single state change per batch
        }
      } else if (target.hasAttribute("data-close-marker")) {
        // content-bottom marker; compare its top to the anchor with hysteresis
        if (idx !== this._activeIndex) continue;
        if ((anchorY - rect.top) >= CloseThresholdPx) {
          var next = this._nextIndex(idx);
          this.CloseAndLock(drawer);
          this._openOnly(next);
          return;
        }
      }
    }
  };

  DrawerController.prototype._NextDrawer = function (drawer) {
    for (var i = 0; i < this._drawers.length; i++) {
      if (this._drawers[i] === drawer) {
        return (i + 1 < this._drawers.length) ? this._drawers[i + 1] : null;
      }
    }
    return null;
  };

  // ---------- Public helpers ----------

  DrawerController.prototype.OpenById = function (id) {
    var drawer = document.getElementById(id);
    if (!drawer) return;
    var idx = this._indexOf(drawer);
    if (!drawer.classList.contains("Drawer--Open")) {
      if (OnlyOneOpenAtATime) this._openOnly(idx);
      else this.OpenDrawer(drawer);
    } else if (OnlyOneOpenAtATime) {
      this._openOnly(idx);
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

  DrawerController.prototype._FindAncestorDrawer = function (node) {
    while (node && node !== document) {
      if (node.hasAttribute && node.hasAttribute("data-drawer")) return node;
      node = node.parentNode;
    }
    return null;
  };

  DrawerController.prototype._ApplyNoTailOnFill = function () {
    for (var i = 0; i < this._drawers.length; i++) {
      var d = this._drawers[i];
      var content = d.querySelector("[data-drawer-content]");
      if (!content) continue;
      if (content.classList.contains("DrawerContent--Fill")) {
        d.classList.add("Drawer--NoTail"); // kill the open-panel tail for fill content
      }
    }
  };

  // ---------- Boot ----------

  function InitializeDrawersWhenReady() {
    document.documentElement.style.setProperty(
      "--ViewportAnchorTriggerLinePositionVh",
      (ViewportAnchorFraction * 100) + "vh"
    );

    // Debug guide line (optional)
    var guide = document.createElement("div");
    guide.className = "TriggerLine";
    document.body.appendChild(guide);

    window.DrawersController = new DrawerController(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeDrawersWhenReady);
  } else {
    InitializeDrawersWhenReady();
  }

  window.DrawerController = DrawerController;
})();