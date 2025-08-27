(function ()
{
  "use strict";

  // Constants (no magic numbers)
  var AnimationDurationMs = 220;

  // DrawerController: manages open/close and simple height animation
  function DrawerController(root)
  {
    this._root = root;
    this._isAnimating = false;

    this.Initialize();
  }

  DrawerController.prototype.Initialize = function ()
  {
    var summaries = this._root.querySelectorAll("[data-drawer-summary]");
    var i;

    for (i = 0; i < summaries.length; i++)
    {
      // Keyboard + click support; bind(this) instead of arrow functions
      summaries[i].addEventListener("click", this.OnToggleRequested.bind(this));
      summaries[i].addEventListener("keydown", this.OnSummaryKeyDown.bind(this));
    }

    // Ensure ARIA state matches the initial classes
    this.SyncAria();
    // Ensure initial content heights are correct for any pre-opened drawer
    this.SyncHeights();
  };

  DrawerController.prototype.OnSummaryKeyDown = function (evt)
  {
    // Space or Enter toggles
    if (evt.key === " " || evt.key === "Enter")
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

    // Find the drawer root for this summary
    var summary = evt.currentTarget;
    var drawer = summary.closest("[data-drawer]");
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
    }
  };

  DrawerController.prototype.OpenDrawer = function (drawer)
  {
    var content = drawer.querySelector("[data-drawer-content]");
    if (!content)
    {
      return;
    }

    // Measure end height before applying class
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

    // Temporarily remove the open class to measure collapsed height (0)
    drawer.classList.remove("Drawer--Open");
    this.SetAriaExpanded(drawer, false);

    var endHeight = 0;

    this.AnimateHeight(content, startHeight, endHeight);
  };

  DrawerController.prototype.AnimateHeight = function (element, startHeight, endHeight)
  {
    var self = this;
    this._isAnimating = true;

    // Set explicit start height for animation
    element.style.height = startHeight + "px";

    // Force layout to ensure the starting height is applied
    void element.offsetHeight;

    element.style.transition = "height " + AnimationDurationMs + "ms ease";
    element.style.height = endHeight + "px";

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
    var drawers = this._root.querySelectorAll("[data-drawer]");
    var i;

    for (i = 0; i < drawers.length; i++)
    {
      var drawer = drawers[i];
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
    var drawers = this._root.querySelectorAll("[data-drawer]");
    var i;

    for (i = 0; i < drawers.length; i++)
    {
      var drawer = drawers[i];
      var content = drawer.querySelector("[data-drawer-content]");
      if (!content)
      {
        continue;
      }

      if (drawer.classList.contains("Drawer--Open"))
      {
        // Set explicit height so animated close has a start value
        content.style.height = content.scrollHeight + "px";
      }
      else
      {
        content.style.height = "";
      }
    }
  };

  // Initialize once DOM is ready (no lambdas)
  function InitializeDrawersWhenReady()
  {
    var root = document;
    new DrawerController(root);
  }

  if (document.readyState === "loading")
  {
    document.addEventListener("DOMContentLoaded", function ()
    {
      InitializeDrawersWhenReady();
    });
  }
  else
  {
    InitializeDrawersWhenReady();
  }

  // Expose class if you need to construct manually elsewhere
  window.DrawerController = DrawerController;

})();
