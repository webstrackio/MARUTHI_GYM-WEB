import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGymSettings } from "@/hooks/use-gym-settings";
import { useToast } from "@/hooks/use-toast";
import { loginAsAdmin, loginAsStudent, logout, useRole } from "@/lib/auth";
import { ShieldCheck, LogOut, Mail, Lock, User, Eye, EyeOff } from "lucide-react";

export default function Admin() {
  const { settings } = useGymSettings();
  const { toast } = useToast();
  const role = useRole();
  const [, navigate] = useLocation();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const ownerConfigured = Boolean(settings.ownerPassword);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerConfigured) {
      toast({
        title: "Owner details not configured",
        description: "Please set the owner password in Settings first.",
        variant: "destructive",
      });
      return;
    }

    if (password === settings.ownerPassword) {
      loginAsAdmin();
      setPassword("");
      toast({ title: "Logged in successfully", description: `Welcome, owner of ${settings.name || "Gym"}` });
      navigate("/");
    } else {
      toast({ title: "Invalid credentials", description: "Password does not match.", variant: "destructive" });
    }
  };

  const handleStudentLogin = () => {
    loginAsStudent({
      id: 0,
      registerNo: "",
      name: "Member",
      phone: "",
    });
    toast({ title: "Logged in successfully", description: "Welcome to the attendance pad" });
    navigate("/attendance-pad");
  };

  const handleLogout = () => {
    logout();
    toast({ title: "Logged out successfully" });
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl text-3xl overflow-hidden"
            style={{ backgroundColor: settings.accentColor }}
          >
            {settings.logoImage ? (
              <img
                src={settings.logoImage}
                alt="Logo"
                className="w-full h-full object-cover"
                style={{ transform: `scale(${settings.cropScale})` }}
              />
            ) : (
              settings.icon
            )}
          </div>
          <h1 className="text-3xl font-bold text-foreground">
            {settings.name || "Gym"} Login
          </h1>
          <p className="text-muted-foreground">
            Login as the gym owner or as a member
          </p>
        </div>

        {role === "admin" ? (
          <Card data-testid="admin-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-green-500" />
                Owner Panel
              </CardTitle>
              <CardDescription>You are logged in as the gym owner</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-muted space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    Email
                  </span>
                  <span className="font-semibold text-foreground">
                    {settings.ownerEmail || "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Lock className="h-4 w-4" />
                    Password
                  </span>
                  <span className="font-semibold text-foreground">
                    {"•".repeat(Math.min((settings.ownerPassword || "").length, 12)) || "-"}
                  </span>
                </div>
              </div>
              <Button
                variant="destructive"
                className="w-full"
                onClick={handleLogout}
                data-testid="button-admin-logout"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/">Back to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="admin-login-form">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Login
              </CardTitle>
              <CardDescription>
                Choose how you want to sign in
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="admin">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="admin" data-testid="tab-admin-login">
                    Owner / Admin
                  </TabsTrigger>
                  <TabsTrigger value="student" data-testid="tab-student-login">
                    Member
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="admin" className="space-y-4">
                  {!ownerConfigured ? (
                    <div className="space-y-4">
                      <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-300">
                        Owner password is not set yet. Please go to Settings and
                        save it before logging in.
                      </div>
                      <Button variant="outline" className="w-full" asChild>
                        <Link href="/settings">Go to Settings</Link>
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleAdminLogin} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="admin-password">Enter Password</Label>
                        <div className="relative">
                          <Input
                            id="admin-password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            data-testid="input-admin-password"
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            data-testid="toggle-admin-password"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                      <Button type="submit" className="w-full" data-testid="button-admin-login">
                        Login as Owner
                      </Button>
                    </form>
                  )}
                </TabsContent>

                <TabsContent value="student" className="space-y-4">
                  <div className="p-4 rounded-lg bg-muted text-sm text-muted-foreground">
                    Members can open the attendance pad directly to check in. No register number or
                    phone number is required.
                  </div>
                  <Button
                    onClick={handleStudentLogin}
                    className="w-full"
                    data-testid="button-student-login"
                  >
                    <User className="mr-2 h-4 w-4" />
                    Open Attendance Pad
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
