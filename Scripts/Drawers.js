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
  var SuppressMsAfterProgrammaticClose = 700;

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

  DrawerController.prototype.OnToggleRequested = function (evt) {
    if (this._isAnimating) return;
    var summary = evt.currentTarget;
    var drawer = summary.closest ? summary.closest("[data-drawer]") : this._FindAncestorDrawer(summary);
    if (!drawer) return;

    if (drawer.classList.contains("Drawer--Open")) {
      this.CloseAndLock(drawer);
    } else {
      this.OpenDrawer(drawer);
      if (OnlyOneOpenAtATime) this.CloseSiblings(drawer);
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

    var endHeight = content.scrollHeight;
    this.AnimateHeight(content, startHeight, endHeight);
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
        content.style.height = content.scrollHeight + "px";
      } else {
        drawer.classList.remove("Drawer--NoTail");
        content.style.height = "";
      }
    }
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

  DrawerController.prototype._OnIntersections = function (entries) {
    var now = this._now();
    var self = this;

    // process in chronological order
    entries.sort(function (a, b) { return a.time - b.time; });

    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;         // only when entering the slice
      if (self._scrollDirection !== 1) return;   // unidirectional (down only)

      var target = entry.target;
      var drawer = target.closest("[data-drawer]");
      if (!drawer) return;

      // respect lockout
      var lockedUntil = parseFloat(drawer.dataset.lockedUntil || "0");
      if (lockedUntil > now) return;

      if (target.matches("[data-drawer-summary]")) {
        if (!drawer.classList.contains("Drawer--Open")) {
          self.OpenDrawer(drawer);
          if (OnlyOneOpenAtATime) self.CloseSiblings(drawer);
        }
      } else if (target.matches("[data-close-marker]")) {
        if (drawer.classList.contains("Drawer--Open")) {
          self.CloseAndLock(drawer);
          var next = self._NextDrawer(drawer);
          if (next) {
            var lockedNext = parseFloat(next.dataset.lockedUntil || "0");
            if (lockedNext <= now && !next.classList.contains("Drawer--Open")) {
              self.OpenDrawer(next);
              if (OnlyOneOpenAtATime) self.CloseSiblings(next);
            }
          }
        }
      }
    });
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