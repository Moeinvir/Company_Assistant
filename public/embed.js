/*!
 * Parsis Bridge widget loader
 * -----------------
 * Drop this on any page:
 *
 *   <script async src="https://your-parsis-bridge-host/embed.js"
 *     data-assistant="pk_xxx"
 *     data-position="bottom-right"
 *     data-theme="dark"
 *     data-label="Ask us anything"></script>
 *
 * The loader renders a launcher in the host page and mounts the widget runtime
 * in an isolated iframe on demand. Everything inside the iframe — the panel,
 * messages, sources and streaming states — is owned by the platform, so host
 * page CSS can never break the widget and the widget can never leak styles back.
 *
 * Configuration is read once from the data attributes so the launcher paints
 * without waiting on the network. Presentation settings (welcome copy, avatar,
 * colours) live in the platform and are applied by the runtime itself.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || script.dataset.parsisMounted === "true") return;
  script.dataset.parsisMounted = "true";

  var origin = new URL(script.src, window.location.href).origin;
  var key = script.dataset.assistant || script.getAttribute("data-key") || "";
  var position = script.dataset.position || "bottom-right";
  var theme = script.dataset.theme || "dark";
  var label = script.dataset.label || "Chat with us";
  var color = script.dataset.color || "#ff7a18";
  var offset = parseInt(script.dataset.offset || "20", 10);
  var zIndex = parseInt(script.dataset.zindex || "2147483000", 10);

  if (!key) {
    console.error("[parsis] embed.js requires data-assistant (the assistant's public key).");
    return;
  }

  var PANEL_WIDTH = 400;
  var PANEL_HEIGHT = 620;

  var root = document.createElement("div");
  root.setAttribute("data-parsis-root", key);
  root.style.cssText = [
    "position:fixed",
    "z-index:" + zIndex,
    "display:flex",
    "flex-direction:column",
    "gap:10px",
    "align-items:" + (position.indexOf("right") > -1 ? "flex-end" : "flex-start"),
    position.indexOf("top") > -1 ? "top:" + offset + "px" : "bottom:" + offset + "px",
    position.indexOf("right") > -1 ? "right:" + offset + "px" : "left:" + offset + "px",
  ].join(";");

  var frame = null;

  function isSmallViewport() {
    return window.innerWidth < 480 || window.innerHeight < 640;
  }

  function mountFrame() {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.title = label;
    frame.setAttribute("allow", "clipboard-write");
    frame.style.cssText = [
      "border:0",
      "border-radius:18px",
      "box-shadow:0 28px 70px -20px rgba(0,0,0,0.8)",
      "background:transparent",
      "color-scheme:" + (theme === "light" ? "light" : "dark"),
    ].join(";");
    frame.src = origin + "/widget/" + encodeURIComponent(key) + "?theme=" + encodeURIComponent(theme);
    root.insertBefore(frame, launcher);
    sizeFrame();
    return frame;
  }

  function sizeFrame() {
    if (!frame) return;
    if (isSmallViewport()) {
      frame.style.width = "calc(100vw - " + offset * 2 + "px)";
      frame.style.height = "calc(100vh - " + (offset * 2 + 56) + "px)";
    } else {
      frame.style.width = PANEL_WIDTH + "px";
      frame.style.height = PANEL_HEIGHT + "px";
    }
  }

  function unmountFrame() {
    if (!frame) return;
    frame.remove();
    frame = null;
  }

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.setAttribute("aria-label", label);
  launcher.setAttribute("aria-expanded", "false");
  launcher.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:8px",
    "border:0",
    "cursor:pointer",
    "padding:12px 16px",
    "border-radius:999px",
    "font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    "color:#140a05",
    "background:" + color,
    "box-shadow:0 14px 34px -12px " + color + "99",
    "transition:transform .18s ease, box-shadow .18s ease",
  ].join(";");

  launcher.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 2.6c1.7 3.4.6 5.3-.7 7-1.6 2-3.4 3.7-3.4 6.4a4.7 4.7 0 0 0 9.4 0c0-1.9-.8-3.1-1.6-4.2-.3 1-.8 1.6-1.6 2 .6-3.2-.8-6.2-2.1-7.9Z" fill="currentColor"/></svg>' +
    "<span>" +
    label.replace(/[<>&]/g, "") +
    "</span>";

  launcher.addEventListener("mouseenter", function () {
    launcher.style.transform = "translateY(-2px)";
  });
  launcher.addEventListener("mouseleave", function () {
    launcher.style.transform = "none";
  });

  var open = false;

  function toggle() {
    open = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      mountFrame();
      frame.focus();
    } else {
      unmountFrame();
    }
  }

  launcher.addEventListener("click", toggle);

  var api = {
    open: function () {
      if (!open) toggle();
    },
    close: function () {
      if (open) toggle();
    },
    destroy: function () {
      unmountFrame();
      root.remove();
      delete window.parsis;
    },
  };

  window.parsis = api;

  window.addEventListener("message", function (event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || data.source !== "parsis-widget") return;
    if (data.type === "close") api.close();
    if (data.type === "ready") {
      window.dispatchEvent(new CustomEvent("parsis:widget:ready", { detail: data }));
    }
  });

  window.addEventListener("resize", sizeFrame);

  root.appendChild(launcher);
  document.body.appendChild(root);
})();
