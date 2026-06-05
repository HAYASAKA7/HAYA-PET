# Linux Window Helper

Future helper responsibility:

- Support X11 terminal window discovery through Xlib, `wmctrl`-style APIs, or an equivalent helper.
- Report limited capability on Wayland instead of assuming global window positioning works.
- Return window bounds for X11 bubble attachment.

The JavaScript facade currently exposes X11 as strategy `x11-window-helper` and Wayland as `manual-fallback`.
