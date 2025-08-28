(function ()
{
  "use strict";

  var LS_TOOLBAR_HIDDEN = "Toolbar_Hidden";

  function ToolbarController()
  {
    this._toolbar      = document.getElementById("Toolbar");
    this._handle       = document.getElementById("ToolbarHandle");
    this._buttons      = this._toolbar ? this._toolbar.querySelectorAll("[data-nav-target]") : [];
    this._userHidden   = false;

    this.Initialize();
  }

  ToolbarController.prototype.Initialize = function ()
  {
    if (!this._toolbar || !this._handle)
    {
      return;
    }

    // Restore persisted state
    this._userHidden = (localStorage.getItem(LS_TOOLBAR_HIDDEN) === "1");
    this.ApplyHiddenState();

    // Wire handle
    this._handle.addEventListener("click", this.OnHandleClick.bind(this));

    // Wire nav buttons
    var i;
    for (i = 0; i < this._buttons.length; i++)
    {
      this._buttons[i].addEventListener("click", this.OnNavClick.bind(this));
    }
  };

  ToolbarController.prototype.OnHandleClick = function ()
  {
    this._userHidden = !this._userHidden;
    localStorage.setItem(LS_TOOLBAR_HIDDEN, this._userHidden ? "1" : "0");
    this.ApplyHiddenState();
  };

  ToolbarController.prototype.OnNavClick = function (evt)
  {
    var targetId = evt.currentTarget.getAttribute("data-nav-target");
    if (!targetId)
    {
      return;
    }

    if (window.DrawersController && typeof window.DrawersController.OpenThenCloseAndScroll === "function")
    {
      // Open the requested section; close others by policy inside controller
      window.DrawersController.OpenThenCloseAndScroll(targetId, ""); // "" means don't force-close a specific one
    }
    else
    {
      // Fallback: smooth scroll only
      var el = document.getElementById(targetId);
      if (el)
      {
        var y = el.getBoundingClientRect().top + window.pageYOffset - 56; // offset for toolbar
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    }
  };

  ToolbarController.prototype.ApplyHiddenState = function ()
  {
    var hidden = !!this._userHidden;

    if (this._toolbar)
    {
      this._toolbar.classList.toggle("Toolbar--Hidden", hidden);
    }

    if (this._handle)
    {
      this._handle.setAttribute("aria-expanded", hidden ? "false" : "true");
      this._handle.title = hidden ? "Show controls" : "Hide controls";
      this._handle.textContent = hidden ? "▾" : "▴";
    }
  };

  // Boot
  function InitializeWhenReady()
  {
    window.ToolbarController = new ToolbarController();
  }

  if (document.readyState === "loading")
  {
    document.addEventListener("DOMContentLoaded", function ()
    {
      InitializeWhenReady();
    });
  }
  else
  {
    InitializeWhenReady();
  }

})();