(function ()
{
  "use strict";

  var Utilities = {};

  Utilities.SetCurrentYear = function (elementId)
  {
    var element = document.getElementById(elementId);
    if (element)
    {
      var now = new Date();
      element.textContent = now.getFullYear();
    }
  };

  // Initialize simple utilities once DOM is ready (no arrow functions)
  if (document.readyState === "loading")
  {
    document.addEventListener("DOMContentLoaded", function ()
    {
      Utilities.SetCurrentYear("Year");
    });
  }
  else
  {
    Utilities.SetCurrentYear("Year");
  }

  // Expose to window (optional)
  window.Utilities = Utilities;

})();
