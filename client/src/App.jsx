import { Switch, Route, useLocation, Redirect } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import Dashboard from "@/pages/dashboard";
import Students from "@/pages/students";
import Payments from "@/pages/payments";
import ModifyPayments from "@/pages/modify-payments";
import IncomeDashboard from "@/pages/income-dashboard";
import PaymentHistory from "@/pages/payment-history";
import AttendanceHistory from "@/pages/attendance-history";
import AttendancePad from "@/pages/attendance-pad-normal";
import GymSettings from "@/pages/gym-settings";
import Admin from "@/pages/admin";
import NotFound from "@/pages/not-found";
import { useRole, logout, getStudentSession } from "@/lib/auth";
import { LogOut } from "lucide-react";
function Router() {
    const [location] = useLocation();
    const role = useRole();
    // Students can only access the attendance pad
    if (role === "student") {
        return location === "/attendance-pad" ? (<AttendancePad />) : (<Redirect to="/attendance-pad"/>);
    }
    // Not logged in: only the login page (and settings for first-time setup), rendered full-screen without any navigation
    if (role === null) {
        if (location === "/login" || location === "/admin")
            return <Admin />;
        if (location === "/settings")
            return <GymSettings />;
        return <Redirect to="/login"/>;
    }
    // Already logged in: the login page has nothing to offer
    if (location === "/login" || location === "/admin") {
        return <Redirect to="/"/>;
    }
    if (location === "/attendance-pad") {
        return (<Switch>
        <Route path="/attendance-pad" component={AttendancePad}/>
        <Route component={NotFound}/>
      </Switch>);
    }
    const noAnimation = ["/settings", "/income-dashboard", "/students"].includes(location);
    const page = (<Switch>
      <Route path="/" component={Dashboard}/>
      <Route path="/students" component={Students}/>
      <Route path="/payments" component={Payments}/>
      <Route path="/modify-payments" component={ModifyPayments}/>
      <Route path="/income-dashboard" component={IncomeDashboard}/>
      <Route path="/payment-history" component={PaymentHistory}/>
      <Route path="/attendance-history" component={AttendanceHistory}/>
      <Route path="/attendance-pad" component={AttendancePad}/>
      <Route path="/settings" component={GymSettings}/>
      <Route component={NotFound}/>
    </Switch>);
    if (noAnimation) {
        return page;
    }
    return (<AnimatePresence mode="wait">
      <motion.div key={location} initial={{ opacity: 0, scale: 0.94, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 1.04, y: -8 }} transition={{ type: "spring", stiffness: 240, damping: 24, mass: 1 }}>
        {page}
      </motion.div>
    </AnimatePresence>);
}
function App() {
    const role = useRole();
    const isStudent = role === "student";
    const isGuest = role === null;
    const style = {
        "--sidebar-width": "16rem",
        "--sidebar-width-icon": "3rem",
    };
    return (<QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          {isStudent ? (<main className="min-h-screen bg-background relative">
              <div className="fixed top-4 right-4 z-50 flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {getStudentSession()?.name}
                </span>
                <Button variant="outline" size="sm" onClick={() => logout()} data-testid="button-student-logout">
                  <LogOut className="mr-2 h-4 w-4"/>
                  Logout
                </Button>
              </div>
              <Router />
            </main>) : isGuest ? (<main className="min-h-screen bg-background" data-testid="login-layout">
              <Router />
            </main>) : (<SidebarProvider style={style}>
              <div className="flex h-screen w-full">
                <AppSidebar />
                <div className="flex flex-col flex-1 overflow-hidden">
                  <header className="flex items-center h-14 px-6 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                    <SidebarTrigger data-testid="button-sidebar-toggle"/>
                  </header>
                  <main className="flex-1 overflow-auto p-6 bg-background">
                    <div className="max-w-7xl mx-auto">
                      <Router />
                    </div>
                  </main>
                </div>
              </div>
            </SidebarProvider>)}
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>);
}
export default App;
