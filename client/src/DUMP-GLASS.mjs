import fs from "node:fs";
const ROOT = "C:/Users/Hi/Desktop/gym-management-system";
const OUT = ROOT + "/client/src/GLASS-README.md";
const JSSRC = ROOT + "/client/src";
const out = [];

const APP = JSSRC + "/App.jsx";
if (fs.existsSync(APP)) {
  out.push("===== App.jsx (layout: navbar + sidebar regions) =====");
  out.push(fs.readFileSync(APP, "utf8"));
} else out.push("MISSING App.jsx");

const SIDE = JSSRC + "/components/app-sidebar.jsx";
out.push("\n===== app-sidebar.jsx: SidebarWrapper/SidebarContent region classNames =====");
if (fs.existsSync(SIDE)) {
  const L = fs.readFileSync(SIDE, "utf8").split("\n");
  L.forEach((t, i) => {
    if (/SidebarContent|SidebarGroup|SidebarFooter|SidebarInset|SidebarHeader|<aside|variant=|collapsible=/.test(t))
      out.push((i + 1) + ": " + t.trim());
  });
} else out.push("MISSING app-sidebar.jsx");

const CSS = JSSRC + "/index.css";
out.push("\n===== index.css last 12 lines + existing @layer glass info =====");
if (fs.existsSync(CSS)) {
  const L = fs.readFileSync(CSS, "utf8").split("\n");
  out.push("total lines: " + L.length);
  L.slice(-12).forEach((t, i) => out.push((L.length - 12 + i + 1) + ": " + t.trim()));
  out.push("-- has glass refs --");
  L.forEach((t, i) => { if (/glass|blur|backdrop/.test(t)) out.push((i + 1) + ": " + t.trim()); });
} else out.push("MISSING index.css");

fs.writeFileSync(OUT, out.join("\n"));
console.log("[ok] wrote " + OUT + " (" + out.join("\n").split("\n").length + " lines)");
