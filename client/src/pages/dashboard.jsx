import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { animate, motion, useInView } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, UserX, CalendarCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useGymSettings } from "@/hooks/use-gym-settings";
import { daysUntil, formatDate, parseDateString } from "@shared/dates";
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
    const todayDate = parseDateString(useToday());
    const { data: stats, isLoading } = useQuery({
        queryKey: ["/api/dashboard/stats"],
    });
    const { data: students } = useQuery({
        queryKey: ["/api/students"],
    });
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
                  <CardTitle className="text-sm font-medium text-muted-foreground">
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
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-200">
              <UserX className="h-5 w-5"/>
              Expired Memberships
            </CardTitle>
            <CardDescription className="text-red-600/70 dark:text-red-300/70">
              {expiredMembers.length > 0
            ? `${expiredMembers.length} member${expiredMembers.length === 1 ? "" : "s"} with expired membership`
            : "No expired memberships"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {expiredMembers.length === 0 ? (<p className="text-sm text-muted-foreground py-2" data-testid="no-expired-memberships">
                All memberships are up to date.
              </p>) : (<div className="space-y-3">
                {expiredMembers.map((member) => (<div key={member.id} className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 rounded-md" data-testid={`expired-member-${member.id}`}>
                    <div>
                      <p className="font-semibold text-foreground">{member.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Reg: {member.registerNo} · Expired: {member.expiryDate ? formatDate(member.expiryDate) : "Never paid"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-red-600 dark:text-red-400">EXPIRED</p>
                      <p className="text-xs text-red-600/70 dark:text-red-400/70">
                        {member.expiryDate
                    ? `${daysOverdue(member.expiryDate)} days overdue`
                    : "No payment recorded"}
                      </p>
                    </div>
                  </div>))}
              </div>)}
          </CardContent>
        </Card>
      </div>
    </div>);
}
