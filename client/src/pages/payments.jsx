import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Receipt, MessageSquare, Copy } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { useGymSettings } from "@/hooks/use-gym-settings";
import { buildPaymentSms, buildSmsLink } from "@/lib/payment-sms";
const formSchema = z.object({
    searchQuery: z.string(),
    studentId: z.number(),
    date: z.string().min(1, "Date is required"),
    duration: z.number().min(1, "Duration must be at least 1 day"),
    amount: z.number().min(1, "Amount must be greater than 0"),
    paymentMethod: z.enum(["cash", "online"]),
});
export default function Payments() {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [smsReceipt, setSmsReceipt] = useState(null);
    const { toast } = useToast();
    const { settings } = useGymSettings();
    const { data: students } = useQuery({
        queryKey: ["/api/students"],
    });
    const { data: payments } = useQuery({
        queryKey: ["/api/payments"],
    });
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            searchQuery: "",
            studentId: 0,
            date: new Date().toISOString().split("T")[0],
            duration: 0,
            amount: 0,
            paymentMethod: "cash",
        },
    });
    const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const filteredStudents = students?.filter((s) => {
        const q = normalize(searchQuery);
        if (!q)
            return false;
        return (normalize(s.name).includes(q) ||
            normalize(s.registerNo).includes(q));
    });
    const handleSearchChange = (value) => {
        setSearchQuery(value);
        if (selectedStudent && value.trim() !== selectedStudent.name) {
            setSelectedStudent(null);
            form.setValue("studentId", 0);
        }
    };
    const paymentMutation = useMutation({
        mutationFn: (data) => apiRequest("POST", "/api/payments", data),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            queryClient.invalidateQueries({ queryKey: ["/api/income/stats"] });
            const student = students?.find((s) => s.id === variables.studentId);
            const phone = student?.phone || variables.phone || "";
            const endDate = getNewExpiryDate(variables.date, variables.duration, student?.expiryDate ?? "");
            const message = buildPaymentSms({
                studentName: variables.studentName,
                amount: variables.amount,
                duration: variables.duration,
                paymentMethod: variables.paymentMethod,
                startDate: variables.date,
                endDate: endDate,
                gymName: settings.name,
            });
            setSmsReceipt({ studentName: variables.studentName, phone, message });
            toast({ title: "Payment recorded successfully" });
            setSelectedStudent(null);
            setSearchQuery("");
            form.reset({
                searchQuery: "",
                studentId: 0,
                date: new Date().toISOString().split("T")[0],
                duration: 0,
                amount: 0,
                paymentMethod: "cash",
            });
        },
        onError: (error) => {
            const errorMessage = error?.message || "Failed to record payment";
            toast({ title: errorMessage, variant: "destructive" });
        },
    });
    const handleSelectStudent = (student) => {
        setSelectedStudent(student);
        form.setValue("studentId", student.id);
        setSearchQuery(student.name);
    };
    const latestTokenNumber = selectedStudent
        ? [...(payments ?? [])]
            .filter((p) => p.studentId === selectedStudent.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
            ?.tokenNumber
        : undefined;
    const getNewExpiryDate = (paymentDate, duration, currentExpiry) => {
        const baseDate = new Date(currentExpiry) > new Date(paymentDate) ? new Date(currentExpiry) : new Date(paymentDate);
        const newDate = new Date(baseDate);
        newDate.setDate(newDate.getDate() + duration);
        return newDate;
    };
    const onSubmit = (data) => {
        if (!selectedStudent) {
            toast({ title: "Please select a student", variant: "destructive" });
            return;
        }
        paymentMutation.mutate({
            date: data.date,
            studentId: selectedStudent.id,
            registerNo: selectedStudent.registerNo,
            studentName: selectedStudent.name,
            phone: selectedStudent.phone,
            duration: data.duration,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
        });
    };
    return (<div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Record Payment</h1>
        <p className="text-sm text-muted-foreground mt-1">Process membership fee payments</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary"/>
              Payment Details
            </CardTitle>
            <CardDescription>Enter payment information</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="search-student">Search Student</Label>
                  <Input id="search-student" placeholder="Search by name or register number..." value={searchQuery} onChange={(e) => handleSearchChange(e.target.value.replace(/[^A-Za-z0-9 .'-]/g, ""))} data-testid="input-search-student"/>
                  {searchQuery && filteredStudents && filteredStudents.length > 0 && (<div className="mt-2 border rounded-md max-h-40 overflow-auto">
                      {filteredStudents.slice(0, 5).map((student) => (<button key={student.id} type="button" className="w-full text-left px-3 py-2 hover-elevate active-elevate-2 text-sm" onClick={() => handleSelectStudent(student)} data-testid={`option-student-${student.id}`}>
                          <div className="font-medium">{student.name}</div>
                          <div className="text-xs text-muted-foreground">{student.registerNo}</div>
                        </button>))}
                    </div>)}
                  {searchQuery.trim() && filteredStudents && filteredStudents.length === 0 && (<p className="mt-2 text-sm text-muted-foreground" data-testid="search-no-results">
                      No matching students found
                    </p>)}
                </div>

                <FormField control={form.control} name="date" render={({ field }) => (<FormItem>
                      <FormLabel>Payment Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-payment-date"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>)}/>

                <FormField control={form.control} name="duration" render={({ field }) => (<FormItem>
                      <FormLabel>Membership Duration (Days) *</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Enter number of days (e.g. 30)" value={field.value === 0 ? "" : field.value} onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : 0)} data-testid="input-duration"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>)}/>

                <FormField control={form.control} name="amount" render={({ field }) => (<FormItem>
                      <FormLabel>Amount (₹) *</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                          <Input type="number" placeholder="Enter amount" value={field.value === 0 ? "" : field.value} onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : 0)} className="pl-7" data-testid="input-amount"/>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>)}/>

                <FormField control={form.control} name="paymentMethod" render={({ field }) => (<FormItem>
                      <FormLabel>Payment Method *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-payment-method">
                            <SelectValue placeholder="Select payment method"/>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="online">Online</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>)}/>

                <Button type="submit" className="w-full bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-white h-11" disabled={paymentMutation.isPending} data-testid="button-record-payment">
                  {paymentMutation.isPending ? "Recording..." : "$  Record Payment"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary"/>
              Membership Preview
            </CardTitle>
            <CardDescription>Preview membership details</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedStudent ? (<div className="space-y-3">
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">Token Number</p>
                  <p className="text-2xl font-bold text-orange-600 dark:text-orange-500">
                    {latestTokenNumber ?? "Not Paid Yet"}
                  </p>
                </div>

                <div className="p-3 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">Student Name</p>
                  <p className="font-bold text-lg">{selectedStudent.name}</p>
                </div>

                <div className="p-3 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">Register Number</p>
                  <p className="font-bold text-lg">{selectedStudent.registerNo}</p>
                </div>

                <div className="p-3 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">Current Expiry Date</p>
                  <p className="font-bold text-lg">
                    {new Date(selectedStudent.expiryDate).toLocaleDateString() === new Date("1970-01-01").toLocaleDateString() ? "Not Set" : new Date(selectedStudent.expiryDate).toLocaleDateString()}
                  </p>
                </div>

                {form.watch("duration") > 0 && form.watch("date") && (<div className="p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md">
                    <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">New Expiry Date</p>
                    <p className="font-bold text-lg text-green-900 dark:text-green-300">
                      {getNewExpiryDate(form.watch("date"), form.watch("duration"), selectedStudent.expiryDate).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }).replace(/ /g, "-")}
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                      {form.watch("duration")} days from payment date
                    </p>
                  </div>)}
              </div>) : (<div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Receipt className="h-16 w-16 mb-4 opacity-20"/>
                <p>Select a student to preview membership details</p>
              </div>)}
          </CardContent>
        </Card>
      </div>

      <Dialog open={smsReceipt !== null} onOpenChange={(open) => !open && setSmsReceipt(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-sms-receipt">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-500"/>
              Payment Receipt SMS
            </DialogTitle>
            <DialogDescription>
              Send this receipt as a normal SMS to {smsReceipt?.studentName}{" "}
              {smsReceipt?.phone ? `(+91 ${smsReceipt.phone})` : ""}
            </DialogDescription>
          </DialogHeader>
          {smsReceipt && (<div className="space-y-4">
              <div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800">
                <pre className="whitespace-pre-wrap text-sm text-foreground font-sans">
                  {smsReceipt.message}
                </pre>
              </div>

              <DialogFooter className="gap-2 sm:justify-start">
                {smsReceipt.phone ? (<a href={buildSmsLink(smsReceipt.phone, smsReceipt.message)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 transition-all duration-150 hover-elevate active-elevate-2 min-h-9 px-4 py-2 bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-white" data-testid="button-send-sms">
                    <MessageSquare className="h-4 w-4"/>
                    Send SMS
                  </a>) : (<p className="text-sm text-muted-foreground">
                    No mobile number on file for this student.
                  </p>)}
                <Button variant="outline" onClick={() => {
                navigator.clipboard.writeText(smsReceipt.message);
                toast({ title: "Message copied to clipboard" });
            }} data-testid="button-copy-sms">
                  <Copy className="h-4 w-4"/>
                  Copy Message
                </Button>
                <Button variant="ghost" onClick={() => setSmsReceipt(null)} data-testid="button-close-sms">
                  Close
                </Button>
              </DialogFooter>
            </div>)}
        </DialogContent>
      </Dialog>
    </div>);
}
