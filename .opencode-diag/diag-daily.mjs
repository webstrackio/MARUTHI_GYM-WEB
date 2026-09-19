import fs from "node:fs";

const ROOT = "C:/Users/Hi/Desktop/gym-management-system";
const COMP = ROOT + "/client/src/components/daily-income.jsx";
const DASH = ROOT + "/client/src/pages/income-dashboard.jsx";
const DISTHTML = ROOT + "/dist/public/index.html";
const DISTJS = ROOT + "/dist/index.js";

const mc = (p) => (fs.existsSync(p) ? fs.statSync(p).mtime.toISOString() : "MISSING");
console.log("source daily-income mtime :", mc(COMP));
console.log("source income-dashboard mtime:", mc(DASH));
console.log("dist/public/index.html mtime:", mc(DISTHTML));
console.log("dist/index.js mtime        :", mc(DISTJS));

let b = 0;
const s = fs.readFileSync(COMP, "utf8");
for (const c of s) { if (c === "{" || c === "(") b++; if (c === "}" || c === ")") b--; }
console.log("daily-income balance:", b);

const usedByName = (name) => {
  const re = new RegExp("\\b" + name + "\\b", "g");
  let n = 0;
  while (re.exec(s)) n++;
  return n;
};

const suspects = ["formatCurrency", "formatIndianNumber", "formatDate", "addDays", "todayString", "calcExpiryDate",
  "membershipPriceMap", "memberShipPriceMap", "useToast", "toast", "useMutation", "useQuery", "useQueryClient",
  "queryClient", "apiRequest", "useForm", "zodResolver", "z", "Button", "Input", "Badge", "Select", "SelectContent",
  "SelectItem", "SelectTrigger", "SelectValue", "Table", "TableBody", "TableCell", "TableHead", "TableHeader",
  "TableRow", "Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle", "DialogFooter",
  "DialogClose", "DialogTrigger", "Skeleton", "Card", "CardContent", "CardDescription", "CardHeader", "CardTitle",
  "Pencil", "Trash2", "Eye", "Inbox", "Receipt", "TrendingUp", "TrendingDown", "Banknote", "CreditCard"];

const importDefs = s.slice(0, s.indexOf("export default") >= 0 ? s.indexOf("export default") : 1400);
for (const n of suspects) {
  const used = usedByName(n);
  const inImports = new RegExp("\\b" + n + "\\b").test(importDefs);
  if (used > 0 && !inImports) console.log("!! USED but NOT in imports:", n, "uses=" + used);
}

const dl = s.split("\n");
const dtId = dl.filter((l) => l.includes("data-testid"));
console.log("testid lines:", dtId.length);

const scroll = dl.length;
const dayUse = dl.filter((l) => /\bday\b/.test(l)).length;
console.log("has 'day' references:", dayUse);
const dataUse = dl.filter((l) => l.includes("data?.day")).length;
console.log("has data?.day refs:", dataUse);
const viewDataUse = dl.filter((l) => l.includes("viewData")).length;
console.log("has viewData refs:", viewDataUse);
console.log("last line number:", scroll);
