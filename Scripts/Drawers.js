(function ()
{
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

  // ============================================

  function DrawerController(root)
  {
    this._root = root;
    this._isAnimating = false;

    this._drawers = null;
    this._summaries = null;

    this._observer = null;
    this._scrollRafPending = false;

    // Debounce state
    this._scrollIdleTimerId = null;
    this._isScrollIdle = true;

    this.Initialize();
  }

  DrawerController.prototype.Initialize = function ()
  {
    this._drawers = this._root.querySelectorAll("[data-drawer]");
    this._summaries = this._root.querySelectorAll("[data-drawer-summary]");

    var i;
    for (i = 0; i < this._summaries.length; i++)
    {
      this._summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      this._summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    this.SyncAria();
    this.SyncHeights();

    if (AutoOpenOnScroll)
    {
      this.EnableScrollAutoToggle();
    }
  };

  // ---------- Interaction ----------

  DrawerController.prototype.OnSummaryKeyDown = function (evt)
  {
    var key = evt.key || "";
    if (key === " " || key === "Enter" || evt.keyCode === 32 || evt.keyCode === 13)
    {
      evt.preventDefault();
      this.OnToggleRequested(evt);
    }
  };

  DrawerController.prototype.OnToggleRequested = function (evt)
  {
    if (this._isAnimating)
    {
      return;
    }

    var summary = evt.currentTarget;
    var drawer = summary.closest ? summary.closest("[data-drawer]") : this._FindAncestorDrawer(summary);
    if (!drawer)
    {
      return;
    }

    var isOpen = drawer.classList.contains("Drawer--Open");
    if (isOpen)
    {
      this.CloseDrawer(drawer);
    }
    else
    {
      this.OpenDrawer(drawer);
      if (OnlyOneOpenAtATime)
      {
        this.CloseSiblings(drawer);
      }
    }
  };

  // ---------- Programmatic open/close ----------

  DrawerController.prototype.OpenDrawer = function (drawer)
  {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content)
    {
      return;
    }

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.add("Drawer--Open");
    this.SetAriaExpanded(drawer, true);

    var endHeight = content.scrollHeight;

    this.AnimateHeight(content, startHeight, endHeight);
  };

  DrawerController.prototype.CloseDrawer = function (drawer)
  {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content)
    {
      return;
    }

    var startHeight = content.getBoundingClientRect().height;

    drawer.classList.remove("Drawer--Open");
    this.SetAriaExpanded(drawer, false);

    var endHeight = 0;

    this.AnimateHeight(content, startHeight, endHeight);
  };

  DrawerController.prototype.CloseSiblings = function (exceptDrawer)
  {
    var i;
    for (i = 0; i < this._drawers.length; i++)
    {
      var d = this._drawers[i];
      if (d !== exceptDrawer && d.classList.contains("Drawer--Open"))
      {
        this.CloseDrawer(d);
      }
    }
  };

  // ---------- Animation + ARIA ----------

  DrawerController.prototype.AnimateHeight = function (element, startHeight, endHeight)
  {
    var self = this;

    if (this._isAnimating)
    {
      element.style.transition = "";
      element.style.height = endHeight > 0 ? (endHeight + "px") : "";
    }

    this._isAnimating = true;

    element.style.height = Math.max(0, startHeight) + "px";
    void element.offsetHeight;

    element.style.transition = "height " + AnimationDurationMs + "ms ease";
    element.style.height = Math.max(0, endHeight) + "px";

    function OnTransitionEnd(e)
    {
      if (e.propertyName === "height")
      {
        element.style.transition = "";
        if (endHeight === 0)
        {
          element.style.height = "";
        }
        else
        {
          element.style.height = endHeight + "px";
        }

        element.removeEventListener("transitionend", OnTransitionEnd);
        self._isAnimating = false;
      }
    }

    element.addEventListener("transitionend", OnTransitionEnd);
  };

  DrawerController.prototype.SyncAria = function ()
  {
    var i;
    for (i = 0; i < this._drawers.length; i++)
    {
      var drawer = this._drawers[i];
      var summary = drawer.querySelector("[data-drawer-summary]");
      if (!summary)
      {
        continue;
      }

      var isOpen = drawer.classList.contains("Drawer--Open");
      summary.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
  };

  DrawerController.prototype.SetAriaExpanded = function (drawer, expanded)
  {
    var summary = drawer.querySelector("[data-drawer-summary]");
    if (summary)
    {
      summary.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
  };

  DrawerController.prototype.SyncHeights = function ()
  {
    var i;
    for (i = 0; i < this._drawers.length; i++)
    {
      var drawer = this._drawers[i];
      var content = drawer.querySelector("[data-drawer-content]");
      if (!content)
      {
        continue;
      }

      if (drawer.classList.contains("Drawer--Open"))
      {
        content.style.height = content.scrollHeight + "px";
      }
      else
      {
        content.style.height = "";
      }
    }
  };

  // ---------- Auto open/close on scroll ----------

  DrawerController.prototype.EnableScrollAutoToggle = function ()
  {
    var self = this;

    // IntersectionObserver helps keep state in sync if scroll events are throttled.
    if ("IntersectionObserver" in window)
    {
      var options = {
        root: null,
        rootMargin: "0px",
        threshold: this._BuildThresholds()
      };
      this._observer = new IntersectionObserver(function ()
      {
        self.OnScroll();
      }, options);

      var i;
      for (i = 0; i < this._summaries.length; i++)
      {
        this._observer.observe(this._summaries[i]);
      }
    }

    // Scroll / resize listeners with optional idle debounce
    if (PauseAutoOpenWhileScrolling)
    {
      window.addEventListener("scroll", function ()
      {
        self._isScrollIdle = false;

        if (self._scrollIdleTimerId)
        {
          clearTimeout(self._scrollIdleTimerId);
        }

        self._scrollIdleTimerId = setTimeout(function ()
        {
          self._isScrollIdle = true;
          self.OnScroll(); // run once when scrolling settles
        }, ScrollIdleMs);
      }, { passive: true });

      window.addEventListener("resize", function ()
      {
        self._isScrollIdle = true;
        self.OnScroll();
      });
    }
    else
    {
      window.addEventListener("scroll", this.OnScroll.bind(this), { passive: true });
      window.addEventListener("resize", this.OnScroll.bind(this));
    }

    this.OnScroll();
  };

  DrawerController.prototype._BuildThresholds = function ()
  {
    var thresholds = [];
    var i;
    for (i = 0; i <= 20; i++)
    {
      thresholds.push(i / 20);
    }
    return thresholds;
  };

  DrawerController.prototype.OnScroll = function ()
  {
    var self = this;

    if (PauseAutoOpenWhileScrolling && !this._isScrollIdle)
    {
      return;
    }

    if (this._scrollRafPending)
    {
      return;
    }

    this._scrollRafPending = true;

    window.requestAnimationFrame(function ()
    {
      self._scrollRafPending = false;
      self.OpenClosestToViewportAnchor();
    });
  };

  DrawerController.prototype.OpenClosestToViewportAnchor = function ()
  {
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    var anchorY = viewportHeight * ViewportAnchorFraction;

    var bestDrawer = null;
    var bestDistance = Number.POSITIVE_INFINITY;

    var i;
    for (i = 0; i < this._drawers.length; i++)
    {
      var drawer = this._drawers[i];
      var summary = drawer.querySelector("[data-drawer-summary]");
      if (!summary)
      {
        continue;
      }

      var rect = summary.getBoundingClientRect();
      var distance = Math.abs(rect.top - anchorY);

      if (distance < bestDistance)
      {
        bestDistance = distance;
        bestDrawer = drawer;
      }
    }

    if (!bestDrawer) { return; }

    var alreadyOpen = bestDrawer.classList.contains("Drawer--Open");
    if (!alreadyOpen)
    {
      this.OpenDrawer(bestDrawer);
    }

    if (OnlyOneOpenAtATime)
    {
      this.CloseSiblings(bestDrawer);
    }
  };

  // ---------- Public helpers ----------

  DrawerController.prototype.OpenById = function (id)
  {
    var drawer = document.getElementById(id);
    if (!drawer) { return; }
    if (!drawer.classList.contains("Drawer--Open"))
    {
      this.OpenDrawer(drawer);
      if (typeof OnlyOneOpenAtATime !== "undefined" && OnlyOneOpenAtATime)
      {
        this.CloseSiblings(drawer);
      }
    }
  };

  DrawerController.prototype.CloseById = function (id)
  {
    var drawer = document.getElementById(id);
    if (!drawer) { return; }
    if (drawer.classList.contains("Drawer--Open"))
    {
      this.CloseDrawer(drawer);
    }
  };

  DrawerController.prototype.ScrollToDrawer = function (id)
  {
    var drawer = document.getElementById(id);
    if (!drawer) { return; }
    var title = drawer.querySelector("[data-drawer-summary]") || drawer;
    var y = title.getBoundingClientRect().top + window.pageYOffset - 16;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  DrawerController.prototype.OpenThenCloseAndScroll = function (openId, closeId)
  {
    this.OpenById(openId);
    this.CloseById(closeId);
    this.ScrollToDrawer(openId);
  };

  DrawerController.prototype._FindAncestorDrawer = function (node)
  {
    while (node && node !== document)
    {
      if (node.hasAttribute && node.hasAttribute("data-drawer"))
      {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  };

  // ---------- Boot ----------

  function InitializeDrawersWhenReady()
  {
    // sync CSS variable so overlay line matches ViewportAnchorFraction
    document.documentElement.style.setProperty(
      "--DrawerTriggerVH",
      (ViewportAnchorFraction * 100) + "vh"
    );

    // inject a yellow guide line element (optional debug)
    var guide = document.createElement("div");
    guide.className = "TriggerLine";
    document.body.appendChild(guide);

    var root = document;
    var instance = new DrawerController(root);
    window.DrawersController = instance;
  }

  if (document.readyState === "loading")
  {
    document.addEventListener("DOMContentLoaded", InitializeDrawersWhenReady);
  }
  else
  {
    InitializeDrawersWhenReady();
  }

  window.DrawerController = DrawerController;

})();