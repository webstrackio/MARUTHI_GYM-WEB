import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarHeader, SidebarSeparator, } from "@/components/ui/sidebar";
import { LayoutDashboard, Users, DollarSign, TrendingUp, History, Calendar, Edit, Settings, LogOut, Moon, Sun, } from "lucide-react";
import { useTheme } from "./theme-provider";
import { useGymSettings } from "@/hooks/use-gym-settings";
import { logout } from "@/lib/auth";
const mainItems = [
    {
        title: "Dashboard",
        url: "/",
        icon: LayoutDashboard,
    },
    {
        title: "Students",
        url: "/students",
        icon: Users,
    },
    {
        title: "Payments",
        url: "/payments",
        icon: DollarSign,
    },
    {
        title: "Attendance",
        url: "/attendance-history",
        icon: Calendar,
    },
    {
        title: "Payment History",
        url: "/payment-history",
        icon: History,
    },
    {
        title: "Modify Payments",
        url: "/modify-payments",
        icon: Edit,
    },
    {
        title: "Income Dashboard",
        url: "/income-dashboard",
        icon: TrendingUp,
    },
];
const managementItems = [
    {
        title: "Settings",
        url: "/settings",
        icon: Settings,
    },
];
function NavItem({ item, delay }) {
    const [location] = useLocation();
    const isActive = location === item.url;
    const testId = `link-${item.title.toLowerCase().replace(/\s+/g, "-")}`;
    return (<motion.li initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: "easeOut", delay }} className="group/menu-item relative flex group-data-[collapsible=icon]:justify-center">
        <SidebarMenuButton asChild isActive={isActive} tooltip={item.title} className="group relative !h-auto pl-5 pr-4 py-3 rounded-none transition-all duration-200 ease-out hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 dark:hover:text-red-400 active:scale-[0.98] data-[active=true]:bg-red-50 dark:data-[active=true]:bg-red-950/30 data-[active=true]:text-red-600 dark:data-[active=true]:text-red-400" data-testid={testId}>
          <Link href={item.url} className="flex items-center gap-3 w-full">
            {isActive && (<motion.span layoutId="sidebar-active-bar" aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" transition={{ duration: 0.3, ease: "easeOut" }}/>)}
            <item.icon className="h-5 w-5 flex-shrink-0 transition-all duration-200 ease-out group-hover:translate-x-[3px] group-hover:scale-105 group-data-[active=true]:scale-105 group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4"/>
            <span className="font-medium text-foreground transition-transform duration-200 ease-out group-hover:translate-x-[2px]">
              {item.title}
            </span>
          </Link>
        </SidebarMenuButton>
      </motion.li>);
}
function ActionItem({ title, icon: Icon, onClick, testId, delay }) {
    return (<motion.li initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: "easeOut", delay }} className="group/menu-item relative flex group-data-[collapsible=icon]:justify-center">
        <SidebarMenuButton asChild tooltip={title} className="group relative !h-auto pl-5 pr-4 py-3 rounded-none transition-all duration-200 ease-out hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 dark:hover:text-red-400 active:scale-[0.98]" data-testid={testId} onClick={onClick}>
          <button type="button" className="flex items-center gap-3 w-full">
            <Icon className="h-5 w-5 flex-shrink-0 transition-all duration-200 ease-out group-hover:translate-x-[3px] group-hover:scale-105 group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4"/>
            <span className="font-medium text-foreground transition-transform duration-200 ease-out group-hover:translate-x-[2px]">
              {title}
            </span>
          </button>
        </SidebarMenuButton>
      </motion.li>);
}
export function AppSidebar() {
    const { theme, setTheme } = useTheme();
    const { settings } = useGymSettings();
    return (<Sidebar collapsible="icon">
      <motion.div className="flex h-full w-full flex-col" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}>
        <SidebarHeader className="p-6 border-b group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:border-b-0">
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity duration-150 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0" data-testid="link-admin" title="Go to dashboard">
          <div className="flex h-10 w-10 items-center justify-center rounded-md text-xl flex-shrink-0 overflow-hidden" style={{ backgroundColor: settings.accentColor }}>
            {settings.logoImage ? (<img src={settings.logoImage} alt="Logo" className="w-full h-full object-cover" style={{ transform: `scale(${settings.cropScale})` }}/>) : (settings.icon)}
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <h1 className="text-lg font-bold text-foreground">
              {settings.name}
            </h1>
            <p className="text-xs text-muted-foreground">Management System</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>MAIN</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item, index) => (<NavItem key={item.title} item={item} delay={index * 0.05}/>))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator/>
        <SidebarGroup>
          <SidebarGroupLabel>MANAGEMENT</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {managementItems.map((item, index) => (<NavItem key={item.title} item={item} delay={(7 + index) * 0.05}/>))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator/>
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>SYSTEM</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <ActionItem title={theme === "dark" ? "Light Mode" : "Dark Mode"} icon={theme === "dark" ? Sun : Moon} testId="button-dark-mode" delay={0.4} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}/>
              <ActionItem title="Logout" icon={LogOut} testId="button-logout" delay={0.45} onClick={() => logout()}/>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      </motion.div>
    </Sidebar>);
}