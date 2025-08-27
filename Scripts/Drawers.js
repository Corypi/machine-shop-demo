// ---------- Internal helpers ----------
DrawerController.prototype._FindAncestorDrawer = function (node)
{
  while (node && node !== document)
  {
    if (node.hasAttribute("data-drawer"))
    {
      return node;
    }
    node = node.parentNode;
  }
  return null;
};