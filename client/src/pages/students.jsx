import { useState, Fragment } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Users, LogIn, AlertCircle, CheckCircle, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStudentSchema } from "@shared/schema";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
const formSchema = insertStudentSchema.omit({ expiryDate: true, registerNo: true }).extend({
    registerNo: z.string().optional(),
    name: z.string().min(1, "Name is required").regex(/^[A-Za-z][A-Za-z .'-]*$/, "Name must contain only letters"),
    phone: z.string().regex(/^[0-9]{10}$/, "Phone number must be exactly 10 digits"),
    address: z.string().min(1, "Address is required"),
});
function MemberCard({ title, description, students, columns, getStatus, getDaysLeft, canCheckIn, onCheckIn, onEdit, isCheckInPending, emptyText, }) {
    const renderCell = (column, student) => {
        const status = getStatus(student.expiryDate);
        switch (column) {
            case "Name":
                return <TableCell className="font-medium">{student.name}</TableCell>;
            case "Register No.":
                return <TableCell className="font-medium">{student.registerNo}</TableCell>;
            case "Phone":
                return <TableCell>{student.phone}</TableCell>;
            case "Address":
                return <TableCell>{student.address}</TableCell>;
            case "Join Date":
                return <TableCell>{new Date(student.joinDate).toLocaleDateString()}</TableCell>;
            case "Expiry Date":
                return (<TableCell>
            {student.expiryDate ? new Date(student.expiryDate).toLocaleDateString() : "-"}
          </TableCell>);
            case "Days Left":
                return (<TableCell className={status === "Active"
                        ? "text-green-600 dark:text-green-400 font-medium"
                        : status === "Pay Required"
                            ? "text-orange-600 dark:text-orange-400 font-medium"
                            : "text-red-600 dark:text-red-400 font-medium"}>
            Days: {getDaysLeft(student.expiryDate)}
          </TableCell>);
            case "Status":
                return (<TableCell>
            <Badge variant={status === "Active" ? "default" : "destructive"} className={status === "Active"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        : status === "Pay Required"
                            ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                            : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"} data-testid={`badge-status-${student.id}`}>
              {status}
            </Badge>
          </TableCell>);
            case "Actions":
                return (<TableCell className="text-right">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="icon" onClick={() => onCheckIn(student.registerNo)} disabled={isCheckInPending || !canCheckIn(student.expiryDate)} title={!canCheckIn(student.expiryDate) ? "Payment required to check in" : "Check in student"} data-testid={`button-attendance-${student.id}`}>
                <LogIn className="h-4 w-4"/>
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onEdit(student)} data-testid={`button-edit-${student.id}`}>
                <Pencil className="h-4 w-4"/>
              </Button>
            </div>
          </TableCell>);
            default:
                return null;
        }
    };
    return (<Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {students && students.length > 0 ? (<div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (<TableHead key={column} className={column === "Actions" ? "text-right" : ""}>
                      {column}
                    </TableHead>))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((student) => (<TableRow key={student.id} data-testid={`row-student-${student.id}`}>
                    {columns.map((column) => (<Fragment key={column}>{renderCell(column, student)}</Fragment>))}
                  </TableRow>))}
              </TableBody>
            </Table>
          </div>) : (<div className="text-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-20"/>
            <p>{emptyText}</p>
          </div>)}
      </CardContent>
    </Card>);
}
export default function Students() {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingStudent, setEditingStudent] = useState(null);
    const [attendanceFeedback, setAttendanceFeedback] = useState(null);
    const { toast } = useToast();
    const { data: studentsData, isLoading } = useQuery({
        queryKey: ["/api/students"],
    });
    const students = studentsData ? [...studentsData].reverse() : undefined;
    const [, navigate] = useLocation();
    const search = useSearch();
    const statusFilter = new URLSearchParams(search).get("status");
    const [activeTab, setActiveTab] = useState(() => {
        if (statusFilter === "active")
            return "active";
        if (statusFilter === "expired")
            return "expired";
        return "all";
    });
    const [searchQuery, setSearchQuery] = useState("");
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            registerNo: "",
            name: "",
            phone: "",
            address: "",
            joinDate: new Date().toISOString().split("T")[0],
        },
    });
    const createMutation = useMutation({
        mutationFn: (data) => apiRequest("POST", "/api/students", data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            toast({ title: "Student added successfully" });
            setIsDialogOpen(false);
            form.reset();
        },
        onError: () => {
            toast({ title: "Failed to add student", variant: "destructive" });
        },
    });
    const updateMutation = useMutation({
        mutationFn: ({ id, ...data }) => apiRequest("PATCH", `/api/students/${id}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            toast({ title: "Student updated successfully" });
            setIsDialogOpen(false);
            setEditingStudent(null);
            form.reset();
        },
        onError: () => {
            toast({ title: "Failed to update student", variant: "destructive" });
        },
    });
    const attendanceMutation = useMutation({
        mutationFn: (registerNo) => apiRequest("POST", "/api/attendance", { registerNumber: Number(registerNo) }),
        onSuccess: async (response) => {
            const data = await response.json();
            if (data.type === "success") {
                queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
                queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            }
            setAttendanceFeedback({
                type: data.type,
                message: data.message,
                data: {
                    name: data.student?.name ?? null,
                    date: new Date().toISOString().split("T")[0],
                    timeIn: data.timeIn ?? null,
                    daysLeft: typeof data.daysLeft === "number" ? data.daysLeft : null,
                    status: typeof data.isExpired === "boolean" ? (data.isExpired ? "EXPIRED" : "ACTIVE") : null,
                },
            });
        },
        onError: (error) => {
            try {
                const body = error.message.slice(error.message.indexOf(": ") + 2);
                const errorData = JSON.parse(body);
                setAttendanceFeedback({
                    type: errorData.type || "not_found",
                    message: errorData.message,
                    data: {
                        name: errorData.student?.name ?? null,
                        date: errorData.student?.expiryDate ?? null,
                        timeIn: errorData.timeIn ?? null,
                        daysLeft: typeof errorData.daysLeft === "number" ? errorData.daysLeft : null,
                        status: typeof errorData.isExpired === "boolean" ? (errorData.isExpired ? "EXPIRED" : "ACTIVE") : null,
                    },
                });
            }
            catch {
                setAttendanceFeedback({
                    type: "not_found",
                    message: "Student not found",
                    data: {
                        name: null,
                        date: null,
                        timeIn: null,
                        daysLeft: null,
                        status: null,
                    },
                });
            }
        },
    });
    const handleOpenDialog = async (student) => {
        if (student) {
            setEditingStudent(student);
            form.reset({
                registerNo: student.registerNo,
                name: student.name,
                phone: student.phone,
                address: student.address,
                joinDate: student.joinDate,
            });
        }
        else {
            setEditingStudent(null);
            form.reset({
                registerNo: "",
                name: "",
                phone: "",
                address: "",
                joinDate: new Date().toISOString().split("T")[0],
            });
            try {
                const res = await apiRequest("GET", "/api/students/next-register-no");
                const data = await res.json();
                form.setValue("registerNo", data.nextRegisterNo);
            }
            catch {
                // Backend will still auto-generate the register number on submit
            }
        }
        setIsDialogOpen(true);
    };
    const onSubmit = (data) => {
        if (editingStudent) {
            updateMutation.mutate({ ...data, id: editingStudent.id });
        }
        else {
            createMutation.mutate(data);
        }
    };
    const getStatus = (expiryDate) => {
        if (!expiryDate)
            return "Pay Required";
        const today = new Date();
        const expiry = new Date(expiryDate);
        if (expiry < today)
            return "Expired";
        const diff = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diff <= 0)
            return "Pay Required";
        return "Active";
    };
    const getDaysLeft = (expiryDate) => {
        if (!expiryDate)
            return 0;
        const today = new Date();
        const expiry = new Date(expiryDate);
        const diff = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return Math.max(0, diff);
    };
    const canCheckIn = (expiryDate) => {
        const daysLeft = getDaysLeft(expiryDate);
        return daysLeft > 0;
    };
    const searchLower = searchQuery.trim().toLowerCase();
    const filteredStudents = students?.filter((s) => {
        if (!searchLower)
            return true;
        return (s.name.toLowerCase().includes(searchLower) ||
            s.registerNo.toLowerCase().includes(searchLower));
    });
    const allStudents = filteredStudents;
    const activeStudents = filteredStudents?.filter((s) => getStatus(s.expiryDate) === "Active");
    const expiredStudents = filteredStudents?.filter((s) => {
        const status = getStatus(s.expiryDate);
        return status === "Expired" || status === "Pay Required";
    });
    return (<div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage gym members</p>
        </div>
        <div className="flex items-center gap-2">
          {statusFilter && (<Button variant="outline" onClick={() => {
                setActiveTab("all");
                navigate("/students");
            }} data-testid="button-show-all-students">
              Show All
            </Button>)}
          <Button onClick={() => handleOpenDialog()} data-testid="button-add-student">
            <Plus className="mr-2 h-4 w-4"/>
            Add Student
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search members by name or register number..." className="pl-10" data-testid="input-search-students"/>
      </div>

      {isLoading ? (<div className="space-y-3">
          {[...Array(5)].map((_, i) => (<Skeleton key={i} className="h-12 w-full"/>))}
        </div>) : (<div className="space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="inline-flex h-auto w-auto gap-1 rounded-full border bg-muted p-1">
              <TabsTrigger value="all" data-testid="tab-students-all" className="rounded-full px-3 py-1 text-sm">
                All
              </TabsTrigger>
              <TabsTrigger value="active" data-testid="tab-students-active" className="rounded-full px-3 py-1 text-sm">
                Active
              </TabsTrigger>
              <TabsTrigger value="expired" data-testid="tab-students-expired" className="rounded-full px-3 py-1 text-sm">
                Expired
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-4">
              <MemberCard title="All Members" description={`${allStudents?.length ?? 0} total member(s)`} students={allStudents} columns={["Register No.", "Name", "Address", "Phone", "Join Date", "Expiry Date", "Days Left", "Status", "Actions"]} getStatus={getStatus} getDaysLeft={getDaysLeft} canCheckIn={canCheckIn} onCheckIn={(registerNo) => attendanceMutation.mutate(registerNo)} onEdit={handleOpenDialog} isCheckInPending={attendanceMutation.isPending} emptyText="No members found. Add your first member to get started."/>
            </TabsContent>

            <TabsContent value="active" className="mt-4">
              <MemberCard title="Active Members" description={`${activeStudents?.length ?? 0} active member(s)`} students={activeStudents} columns={["Register No.", "Name", "Phone", "Address", "Join Date", "Expiry Date", "Days Left", "Status", "Actions"]} getStatus={getStatus} getDaysLeft={getDaysLeft} canCheckIn={canCheckIn} onCheckIn={(registerNo) => attendanceMutation.mutate(registerNo)} onEdit={handleOpenDialog} isCheckInPending={attendanceMutation.isPending} emptyText="No active members right now."/>
            </TabsContent>

            <TabsContent value="expired" className="mt-4">
              <MemberCard title="Expired Members" description={`${expiredStudents?.length ?? 0} expired / unpaid member(s)`} students={expiredStudents} columns={["Register No.", "Name", "Phone", "Address", "Join Date", "Expiry Date", "Days Left", "Status", "Actions"]} getStatus={getStatus} getDaysLeft={getDaysLeft} canCheckIn={canCheckIn} onCheckIn={(registerNo) => attendanceMutation.mutate(registerNo)} onEdit={handleOpenDialog} isCheckInPending={attendanceMutation.isPending} emptyText="No expired or unpaid members."/>
            </TabsContent>
          </Tabs>
        </div>)}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent data-testid="dialog-student-form">
          <DialogHeader>
            <DialogTitle>{editingStudent ? "Edit Student" : "Add New Student"}</DialogTitle>
            <DialogDescription>
              {editingStudent ? "Update student information" : "Enter student details to register"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="registerNo" render={({ field }) => (<FormItem>
                    <FormLabel>Register Number <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} disabled readOnly placeholder="Auto-generated" data-testid="input-register-no"/>
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Auto-generated by the system. Cannot be edited.</p>
                    <FormMessage />
                  </FormItem>)}/>
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem>
                    <FormLabel>Full Name <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={50} placeholder="Enter full name" onChange={(e) => field.onChange(e.target.value.replace(/[^A-Za-z .'-]/g, ""))} data-testid="input-name"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>
              <FormField control={form.control} name="phone" render={({ field }) => (<FormItem>
                    <FormLabel>Phone <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="numeric" maxLength={10} placeholder="10 digit mobile number" onChange={(e) => field.onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} data-testid="input-phone"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>
              <FormField control={form.control} name="address" render={({ field }) => (<FormItem>
                    <FormLabel>Address <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Enter address" {...field} data-testid="input-address"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>
              <FormField control={form.control} name="joinDate" render={({ field }) => (<FormItem>
                    <FormLabel>Join Date <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-join-date"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-student">
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingStudent ? "Update" : "Add Student"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={attendanceFeedback !== null} onOpenChange={(open) => !open && setAttendanceFeedback(null)}>
        <DialogContent className="max-w-md" data-testid={`feedback-${attendanceFeedback?.type}`}>
          {attendanceFeedback && (<div className="space-y-6">
              <div className="text-center">
                {attendanceFeedback.type === "success" ? (<div className="space-y-3">
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto"/>
                    <h2 className="text-2xl font-bold text-green-600 dark:text-green-400">Welcome</h2>
                  </div>) : (<div className="space-y-3">
                    <AlertCircle className="h-16 w-16 text-red-500 mx-auto"/>
                    <h2 className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {attendanceFeedback.type === "expired" ? "Membership Expired" :
                    attendanceFeedback.type === "warning" ? "Already Checked In" :
                        "Student Not Found"}
                    </h2>
                  </div>)}
              </div>

              {attendanceFeedback.data.name && (<div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-900/30 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Name:</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{attendanceFeedback.data.name}</span>
                  </div>
                  {attendanceFeedback.data.date && (<div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Date:</span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{attendanceFeedback.data.date}</span>
                    </div>)}
                  {attendanceFeedback.data.timeIn && (<div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Time In:</span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{attendanceFeedback.data.timeIn}</span>
                    </div>)}
                  {attendanceFeedback.data.daysLeft !== null && attendanceFeedback.data.daysLeft !== undefined && (<div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Days Left:</span>
                      <span className={`font-semibold ${Math.max(0, attendanceFeedback.data.daysLeft) > 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"}`}>
                        {Math.max(0, attendanceFeedback.data.daysLeft)} days
                      </span>
                    </div>)}
                  {attendanceFeedback.data.status && (<div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Status:</span>
                      <span className={`font-semibold ${attendanceFeedback.data.status === "ACTIVE"
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"}`}>
                        {attendanceFeedback.data.status}
                      </span>
                    </div>)}
                </div>)}

              <Button onClick={() => setAttendanceFeedback(null)} className={`w-full font-semibold text-white py-2 h-auto rounded-md ${attendanceFeedback.type === "success"
                ? "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
                : "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"}`} data-testid="button-close-feedback">
                Close
              </Button>
            </div>)}
        </DialogContent>
      </Dialog>
    </div>);
}
