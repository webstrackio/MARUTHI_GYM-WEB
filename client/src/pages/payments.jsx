import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Calendar, CreditCard, Pencil, Receipt } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useGymSettings } from "@/hooks/use-gym-settings";
import { normalizeBatch } from "@shared/schema";
import { cn } from "@/lib/utils";
import { calcExpiryDate, formatDate, todayString } from "@shared/dates";
const formSchema = z.object({
    searchQuery: z.string(),
    studentId: z.number(),
    date: z.string().min(1, "Date is required"),
    durationMonths: z.number().min(1, "Duration is required"),
    amount: z.number().min(1, "Amount must be greater than 0"),
    paymentMethod: z.enum(["cash", "online"]),
});
// Parses a "DD/MM/YYYY" display string into a "YYYY-MM-DD" storage string.
// Returns "" for anything that is not a real calendar date.
function parseDdmmyyyy(text) {
    const match = (text || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match)
        return "";
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return "";
    const dt = new Date(year, month - 1, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day)
        return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
// A dual-mode date field. It shows a plain editable text input that formats
// keystrokes as DD/MM/YYYY, backed by a native date picker that opens when the
// calendar icon is clicked. `value` is always "YYYY-MM-DD"; `onChange` fires
// with the parsed value once a complete valid date is entered or picked.
// `onTextChange` fires with the raw DD/MM/YYYY text on every keystroke so the
// parent can validate what the user actually typed.
function DateInput({ value, onChange, onTextChange, disabled = false, readOnly = false, className, placeholder = "DD/MM/YYYY", label, "data-testid": dataTestId, "data-testid-calendar": dataTestIdCalendar }) {
    const [text, setText] = useState(() => formatDate(value));
    const lastValue = useRef(value);
    useEffect(() => {
        if (value !== lastValue.current) {
            lastValue.current = value;
            setText(formatDate(value));
        }
    }, [value]);
    const toDigits = (raw) => raw.replace(/\D/g, "").slice(0, 8);
    const mask = (digits) => {
        if (digits.length > 4)
            return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
        if (digits.length > 2)
            return `${digits.slice(0, 2)}/${digits.slice(2)}`;
        return digits;
    };
    const handleTextChange = (e) => {
        if (readOnly || disabled)
            return;
        const digits = toDigits(e.target.value);
        const formatted = mask(digits);
        setText(formatted);
        const parsed = digits.length === 8 ? parseDdmmyyyy(formatted) : "";
        if (parsed) {
            lastValue.current = parsed;
            onChange(parsed);
        }
        else if (digits.length === 0) {
            onChange("");
        }
        onTextChange?.(formatted);
    };
    const handlePickerChange = (e) => {
        const picked = e.target.value;
        e.target.value = "";
        if (!picked)
            return;
        lastValue.current = picked;
        setText(formatDate(picked));
        onChange(picked);
        onTextChange?.(formatDate(picked));
    };
    return (<div className="relative">
      <Input value={text} onChange={handleTextChange} placeholder={placeholder} disabled={disabled} readOnly={readOnly} aria-label={label} className={cn("pr-9", className)} data-testid={dataTestId}/>
      <Calendar className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"/>
      <input type="date" value={value || ""} onChange={handlePickerChange} aria-label={`${label} calendar`} data-testid={dataTestIdCalendar} disabled={disabled || readOnly} style={{ colorScheme: "light dark" }} className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2 cursor-pointer opacity-0"/>
    </div>);
}
export default function Payments() {
    const search = useSearch();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedStudent, setSelectedStudent] = useState(null);
    const autoSelectedRef = useRef(false);
    const [isEditingExpiry, setIsEditingExpiry] = useState(false);
    const [pendingExpiry, setPendingExpiry] = useState(null);
    const [pendingExpiryText, setPendingExpiryText] = useState("");
    const [pendingExpiryError, setPendingExpiryError] = useState(null);
    const [editedExpiry, setEditedExpiry] = useState(null);
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
            date: todayString(),
            durationMonths: 0,
            amount: 0,
            paymentMethod: "cash",
        },
    });
    useEffect(() => {
        if (autoSelectedRef.current || !students || !search)
            return;
        const studentId = Number(new URLSearchParams(search).get("studentId"));
        if (!studentId)
            return;
        const student = students.find((s) => s.id === studentId);
        if (student) {
            autoSelectedRef.current = true;
            setSelectedStudent(student);
            setSearchQuery(student.name);
            form.setValue("studentId", student.id);
        }
    }, [students, search]);
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
            queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/income/daily") });
            toast({ title: "Payment recorded successfully" });
            setSelectedStudent(null);
            setSearchQuery("");
            setEditedExpiry(null);
            setIsEditingExpiry(false);
            setPendingExpiry(null);
            setPendingExpiryText("");
            setPendingExpiryError(null);
            form.reset({
                searchQuery: "",
                studentId: 0,
                date: todayString(),
                durationMonths: 0,
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
    const getNewExpiryDate = (paymentDate, durationMonths, currentExpiry) => {
        const baseDate = new Date(currentExpiry) > new Date(paymentDate) ? new Date(currentExpiry) : new Date(paymentDate);
        return calcExpiryDate(baseDate, durationMonths);
    };
    const watchedDate = form.watch("date");
    const watchedDuration = form.watch("durationMonths");
    const showExpiryPreview = watchedDuration > 0 && watchedDate;
    const autoExpiryDate = showExpiryPreview ? getNewExpiryDate(watchedDate, watchedDuration, selectedStudent?.expiryDate ?? "") : null;
    const autoExpiryInput = autoExpiryDate || "";
    const expiryInputValue = editedExpiry ?? autoExpiryInput;
    useEffect(() => {
        setEditedExpiry(null);
        setPendingExpiry(null);
        setPendingExpiryText("");
        setPendingExpiryError(null);
        setIsEditingExpiry(false);
    }, [watchedDate, watchedDuration, selectedStudent?.id]);
    const handleStartEditExpiry = () => {
        setPendingExpiry(expiryInputValue);
        setPendingExpiryText(expiryInputValue ? formatDate(expiryInputValue) : "");
        setPendingExpiryError(null);
        setIsEditingExpiry(true);
    };
    const handleSaveExpiry = () => {
        const parsed = parseDdmmyyyy(pendingExpiryText);
        if (!parsed) {
            setPendingExpiryError("Enter a valid date in DD/MM/YYYY format");
            return;
        }
        setEditedExpiry(parsed);
        setPendingExpiry(parsed);
        setPendingExpiryError(null);
        setIsEditingExpiry(false);
        setPendingExpiryText("");
    };
    const handleCancelExpiry = () => {
        setIsEditingExpiry(false);
        setPendingExpiry(null);
        setPendingExpiryText("");
        setPendingExpiryError(null);
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
            duration: data.durationMonths,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            expiryDate: editedExpiry ?? undefined,
        });
    };
    return (<div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Record Payment</h1>
        <p className="text-sm text-muted-foreground mt-1">Process membership fee payments{selectedStudent ? ` — ${normalizeBatch(selectedStudent.batch) === "morning" ? "Morning Batch" : "Evening Batch"}` : ""}</p>
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
                          <div className="text-xs text-muted-foreground">{student.registerNo} &middot; {normalizeBatch(student.batch) === "morning" ? "Morning" : "Evening"} Batch</div>
                        </button>))}
                    </div>)}
                  {searchQuery.trim() && filteredStudents && filteredStudents.length === 0 && (<p className="mt-2 text-sm text-muted-foreground" data-testid="search-no-results">
                      No matching students found
                    </p>)}
                </div>

                <FormField control={form.control} name="date" render={({ field }) => (<FormItem>
                      <FormLabel>Payment Date *</FormLabel>
                      <FormControl>
                        <DateInput value={field.value} onChange={(v) => field.onChange(v)} label="Payment Date" data-testid="input-payment-date" data-testid-calendar="calendar-payment-date"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>)}/>

                <FormField control={form.control} name="durationMonths" render={({ field }) => (<FormItem>
                      <FormLabel>Membership Duration *</FormLabel>
                      <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value ? String(field.value) : undefined}>
                        <FormControl>
                          <SelectTrigger data-testid="select-membership-duration">
                            <SelectValue placeholder="Select duration"/>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1">1 Month</SelectItem>
                          <SelectItem value="2">2 Months</SelectItem>
                          <SelectItem value="3">3 Months</SelectItem>
                          <SelectItem value="6">6 Months</SelectItem>
                          <SelectItem value="12">1 Year</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>)}/>

                {form.watch("date") && form.watch("durationMonths") > 0 && (<FormItem>
                      <div className="flex items-center justify-between gap-2">
                        <FormLabel>Expiry Date</FormLabel>
                        {!isEditingExpiry && (<Button variant="ghost" size="sm" className="h-7 px-2 text-xs" type="button" onClick={handleStartEditExpiry} data-testid="button-edit-expiry">
                            <Pencil className="h-3.5 w-3.5 mr-1"/>
                            Edit
                          </Button>)}
                      </div>
                      <FormControl>
                        {isEditingExpiry ? (<div className="space-y-2">
                            <DateInput value={pendingExpiry || expiryInputValue} onChange={setPendingExpiry} onTextChange={(t) => {
                                setPendingExpiryText(t);
                                setPendingExpiryError(null);
                            }} label="Expiry Date" data-testid="input-edit-expiry" data-testid-calendar="calendar-edit-expiry"/>
                            {pendingExpiryError && (<p className="text-sm font-medium text-destructive" data-testid="expiry-validation-error">
                                {pendingExpiryError}
                              </p>)}
                            <div className="flex gap-2">
                              <Button size="sm" type="button" className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleSaveExpiry} data-testid="button-save-expiry">
                                Save
                              </Button>
                              <Button size="sm" type="button" variant="outline" className="flex-1" onClick={handleCancelExpiry} data-testid="button-cancel-expiry">
                                Cancel
                              </Button>
                            </div>
                          </div>) : (<DateInput value={expiryInputValue} readOnly label="Expiry Date" data-testid="input-expiry-date" data-testid-calendar="calendar-expiry-date"/>)}
                      </FormControl>
                      <p className="text-xs text-muted-foreground">{editedExpiry ? "Manually edited expiry date (overrides automatic calculation)" : "Calculated automatically from the payment date and duration."}</p>
                    </FormItem>)}

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
                      <Select onValueChange={field.onChange} value={field.value}>
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
                  {paymentMutation.isPending ? "Recording..." : "Record Payment"}
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
                  <p className="text-xs text-muted-foreground">Batch</p>
                  <p className="font-bold text-lg">{normalizeBatch(selectedStudent.batch) === "morning" ? "Morning Batch" : "Evening Batch"}</p>
                </div>

                <div className="p-3 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">Current Expiry Date</p>
                  <p className="font-bold text-lg">
                    {selectedStudent.expiryDate ? formatDate(selectedStudent.expiryDate) : "Not Set"}
                  </p>
                </div>

                {showExpiryPreview && (<div className="p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md">
                    <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">New Expiry Date</p>
                    <p className="font-bold text-lg text-green-900 dark:text-green-300 tabular-nums" data-testid="text-new-expiry-date">{formatDate(expiryInputValue)}</p>
                    {editedExpiry ? (<p className="text-xs text-green-700 dark:text-green-400 mt-1">Manually set expiry date (overrides automatic calculation)</p>) : (<p className="text-xs text-green-700 dark:text-green-400 mt-1">
                        {watchedDuration} month{watchedDuration > 1 ? "s" : ""} from membership start date
                      </p>)}
                  </div>)}
              </div>) : (<div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Receipt className="h-16 w-16 mb-4 opacity-20"/>
                <p>Select a student to preview membership details</p>
              </div>)}
          </CardContent>
        </Card>
      </div>
    </div>);
}
