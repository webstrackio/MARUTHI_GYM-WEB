import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { animate, motion, useInView } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WhatsAppBulkDialog, WhatsAppMessageDialog } from "@/components/whatsapp-dialogs";
import { Users, UserCheck, UserX, CalendarCheck, MessageCircle, Pencil, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useGymSettings } from "@/hooks/use-gym-settings";
import { daysUntil, formatDate, parseDateString } from "@shared/dates";
import { getGymName } from "@/lib/whatsapp";
import { useToday } from "@/hooks/use-today";
function CountUp({ value, delay = 0 }) {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: "-40px" });
    const [display, setDisplay] = useState(0);
    useEffect(() => {
        if (!inView)
            return;
        const controls = animate(0, value, {
            duration: 1,
            delay,
            ease: "easeOut",
            onUpdate: (latest) => {
                setDisplay(Math.round(latest));
            },
        });
        return () => controls.stop();
    }, [inView, value, delay]);
    return <span ref={ref}>{display}</span>;
}
export default function Dashboard() {
    const { settings } = useGymSettings();
    const gymName = getGymName(settings);
    const todayDate = parseDateString(useToday());
    const [, navigate] = useLocation();
    const { data: stats, isLoading } = useQuery({
        queryKey: ["/api/dashboard/stats"],
    });
    const { data: students } = useQuery({
        queryKey: ["/api/students"],
    });
    const [whatsappMember, setWhatsappMember] = useState(null);
    const [isWhatsAppAllOpen, setIsWhatsAppAllOpen] = useState(false);
    const daysOverdue = (expiryDate) => {
        return Math.max(0, -daysUntil(expiryDate, todayDate));
    };
    const expiredMembers = students?.filter((s) => {
        // A student with no payment recorded (no expiry date) is treated as expired
        if (!s.expiryDate)
            return true;
        // Expired when no days remain (expiry is today or earlier)
        return daysUntil(s.expiryDate, todayDate) <= 0;
    }) || [];
    const statCards = [
        {
            title: "Total Students",
            value: stats?.totalStudents ?? 0,
            icon: Users,
            color: "text-blue-500",
            bgColor: "bg-blue-500",
            href: "/students",
        },
        {
            title: "Active Memberships",
            value: stats?.activeMemberships ?? 0,
            icon: UserCheck,
            color: "text-green-500",
            bgColor: "bg-green-500",
            href: "/students?status=active",
        },
        {
            title: "Expired Memberships",
            value: expiredMembers.length,
            icon: UserX,
            color: "text-red-500",
            bgColor: "bg-red-500",
            href: "/students?status=expired",
        },
        {
            title: "Today's Attendance",
            value: stats?.todayAttendance ?? 0,
            icon: CalendarCheck,
            color: "text-purple-500",
            bgColor: "bg-purple-500",
            href: "/attendance-history",
        },
    ];
    return (<div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Welcome to {settings.name || "GymDesk"} Management System</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => (<motion.div key={stat.title} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut", delay: index * 0.1 } }} whileHover={{ y: -3, transition: { duration: 0.12, ease: "easeOut" } }} transition={{ duration: 0.2, ease: "easeOut" }}>
            <Link href={stat.href} data-testid={`card-link-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <Card className="cursor-pointer transition-shadow duration-300 hover:shadow-md" data-testid={`card-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground min-w-0 break-words">
                    {stat.title}
                  </CardTitle>
                  <motion.div className={`h-8 w-8 rounded-md ${stat.bgColor} flex items-center justify-center`} initial={{ scale: 0.8, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: "easeOut", delay: index * 0.1 + 0.3 }}>
                    <stat.icon className="h-4 w-4 text-white"/>
                  </motion.div>
                </CardHeader>
                <CardContent>
                  {isLoading ? (<Skeleton className="h-10 w-20"/>) : (<p className="text-3xl font-bold text-foreground" data-testid={`text-${stat.title.toLowerCase().replace(/\s+/g, '-')}-value`}>
                      <CountUp value={stat.value} delay={index * 0.1 + 0.3}/>
                    </p>)}
                </CardContent>
              </Card>
            </Link>
          </motion.div>))}
      </div>

      <div>
        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900">
          {/* Stacks below md. The previous hard `flex-row` plus a `shrink-0`
              button forced a minimum width of about 330px (the un-wrappable
              "Expired Memberships — 8 members" title, plus the button and the
              gap), so on a 320px phone the heading kept its full width and pushed
              Message All out past the card's right edge. */}
          <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 space-y-0">
            {/* min-w-0 lets the heading column shrink below its intrinsic text
                width, which is what actually allows the button to stay inside. */}
            <div className="min-w-0 flex-1">
              <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-red-700 dark:text-red-200">
                <UserX className="h-5 w-5 shrink-0"/>
                <span className="min-w-0 break-words">Expired Memberships</span>
                {expiredMembers.length > 0 && <span className="text-base font-normal text-red-600/80 dark:text-red-300/80" data-testid="text-expired-membership-count">
                  &mdash; {expiredMembers.length} member{expiredMembers.length === 1 ? "" : "s"}
                </span>}
              </CardTitle>
              <CardDescription className="text-red-600/70 dark:text-red-300/70 break-words">
                {expiredMembers.length > 0
            ? `${expiredMembers.length} member${expiredMembers.length === 1 ? "" : "s"} with expired membership`
            : "No expired memberships"}
              </CardDescription>
            </div>
            {/* Full width on mobile so it fits the card by construction, and
                `shrink-0` only from md up, where there is room to sit beside the
                heading. On a phone it no longer competes with the title for
                horizontal space at all. */}
            {expiredMembers.length > 0 && (<Button
              onClick={() => setIsWhatsAppAllOpen(true)}
              className="w-full md:w-auto md:shrink-0 bg-green-600 hover:bg-green-700 text-white"
              data-testid="button-whatsapp-all"
            >
              <MessageCircle className="h-4 w-4 shrink-0"/>
              Message All
            </Button>)}
          </CardHeader>
          <CardContent>
            {expiredMembers.length === 0 ? (<p className="text-sm text-muted-foreground py-2" data-testid="no-expired-memberships">
                All memberships are up to date.
              </p>) : (<div className="space-y-3">
                {expiredMembers.map((member) => (<div key={member.id} className="p-4 bg-white dark:bg-slate-900 rounded-md space-y-3 min-w-0" data-testid={`expired-member-${member.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* `truncate` was replaced with wrapping: a long name is
                            more useful on two lines than hidden behind an
                            ellipsis, and `min-w-0` on the parent is what lets
                            the box shrink rather than push the badge out. */}
                        <p className="font-semibold text-foreground break-words">{member.name}</p>
                        <p className="text-sm text-muted-foreground break-words">
                          Reg: {member.registerNo} · Expired: {member.expiryDate ? formatDate(member.expiryDate) : "Never paid"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="destructive" className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" data-testid={`badge-expired-${member.id}`}>
                          {member.expiryDate ? "🔴 EXPIRED" : "🟡 NEVER PAID"}
                        </Badge>
                        <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-1">
                          {member.expiryDate
                            ? `${daysOverdue(member.expiryDate)} days overdue`
                            : "No payment"}
                        </p>
                      </div>
                    </div>
                    {/* Two equal columns on phones with Renew spanning the full
                        width, then back to the existing single right-aligned row
                        from sm up. Every button stays inside the card because a
                        grid cell cannot be overrun by its content. */}
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
                      <Button size="sm" onClick={() => setWhatsappMember(member)} className="bg-green-600 hover:bg-green-700 text-white" data-testid={`button-whatsapp-member-${member.id}`}>
                        <MessageCircle className="h-4 w-4"/>
                        WhatsApp
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/students?status=expired&memberId=${member.id}`)} data-testid={`button-edit-member-${member.id}`}>
                        <Pencil className="h-4 w-4"/>
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/payments?studentId=${member.id}`)} className="col-span-2 sm:col-span-1" data-testid={`button-renew-member-${member.id}`}>
                        <Wallet className="h-4 w-4"/>
                        Renew
                      </Button>
                    </div>
                  </div>))}
              </div>)}
          </CardContent>
        </Card>
      </div>

      <WhatsAppMessageDialog
        open={whatsappMember !== null}
        onOpenChange={(open) => !open && setWhatsappMember(null)}
        member={whatsappMember}
        gymName={gymName}
      />
      <WhatsAppBulkDialog
        open={isWhatsAppAllOpen}
        onOpenChange={setIsWhatsAppAllOpen}
        members={expiredMembers}
        gymName={gymName}
      />
    </div>);
}
