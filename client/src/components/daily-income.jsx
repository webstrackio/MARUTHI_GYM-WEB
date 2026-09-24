import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Banknote, Calendar, ChevronLeft, ChevronRight, CreditCard, Eye, Inbox, Pencil, Receipt, Trash2, TrendingUp } from "lucide-react";
import { formatCurrency, formatIndianNumber } from "@/lib/utils";
import { addDays, formatDate, todayString } from "@shared/dates";

const editPaymentSchema = z.object({
    date: z.string().min(1, "Date is required"),
    durationMonths: z.number().min(1, "Duration is required"),
    amount: z.number().min(1, "Amount must be greater than 0"),
    paymentMethod: z.enum(["cash", "online"]),
});

export default function DailyIncome() {
    const [selectedDate, setSelectedDate] = useState(todayString);
    const [viewDate, setViewDate] = useState(null);
    const selectedWeekday = selectedDate
        ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" })
        : null;
    const [editingPayment, setEditingPayment] = useState(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const { toast } = useToast();
    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: [`/api/income/daily?date=${selectedDate}`],
    });
    const { data: viewData, isLoading: viewLoading, isError: viewError, refetch: viewRefetch, } = useQuery({
        queryKey: [`/api/income/daily?date=${viewDate ?? ""}`],
        enabled: viewDate !== null,
    });
    const form = useForm({
        resolver: zodResolver(editPaymentSchema),
        defaultValues: {
            date: todayString(),
            durationMonths: 1,
            amount: 0,
            paymentMethod: "cash",
        },
    });
    const updateMutation = useMutation({
        mutationFn: ({ id, ...data }) => apiRequest("PATCH", `/api/payments/${id}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/income/daily") });
            queryClient.invalidateQueries({ queryKey: ["/api/income/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
            toast({ title: "Payment updated successfully" });
            setEditingPayment(null);
            form.reset();
        },
        onError: (error) => {
            console.error("Update payment failed:", error);
            toast({ title: error?.message || "Failed to update payment", variant: "destructive" });
        },
    });
    const deleteMutation = useMutation({
        mutationFn: (id) => apiRequest("DELETE", `/api/payments/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/income/daily") });
            queryClient.invalidateQueries({ queryKey: ["/api/income/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
            toast({ title: "Payment deleted successfully" });
            setDeleteConfirmId(null);
        },
        onError: (error) => {
            console.error("Delete payment failed:", error);
            toast({ title: error?.message || "Failed to delete payment", variant: "destructive" });
        },
    });
    const day = data?.day;
    const last7Days = data?.last7Days ?? [];
    const maxIncome = Math.max(1, ...last7Days.map((d) => d.total));
    const handleEditClick = (payment) => {
        setEditingPayment(payment);
        form.reset({
            date: payment.date,
            durationMonths: payment.durationMonths ?? payment.duration ?? 1,
            amount: payment.amount,
            paymentMethod: payment.paymentMethod,
        });
    };
    const onSubmit = (values) => {
        if (editingPayment) {
            updateMutation.mutate({ ...values, duration: values.durationMonths, id: editingPayment.id });
        }
    };
    const visiblePayments = viewData?.payments ?? [];
    return (<Card data-testid="card-daily-income">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary"/>
          Daily Income
        </CardTitle>
        <CardDescription>Daily payment breakdown and history</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Date navigator */}
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <Button variant="outline" size="icon" onClick={() => setSelectedDate(addDays(selectedDate, -1))} data-testid="button-previous-day">
            <ChevronLeft className="h-4 w-4"/>
            <span className="sr-only">Previous Day</span>
          </Button>
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
            <div className="text-center sm:text-right">
              <p className="text-xl font-bold text-foreground tabular-nums" data-testid="text-selected-date">{formatDate(selectedDate)}</p>
              {selectedWeekday && <p className="text-xs text-muted-foreground">{selectedWeekday}</p>}
            </div>
            <Input type="date" value={selectedDate} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="w-auto" data-testid="input-date-select" aria-label="Select date"/>
          </div>
          <Button variant="outline" size="icon" onClick={() => setSelectedDate(addDays(selectedDate, 1))} data-testid="button-next-day">
            <ChevronRight className="h-4 w-4"/>
            <span className="sr-only">Next Day</span>
          </Button>
        </div>

        {/* Summary cards for the selected date */}
        {isLoading ? (<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (<Skeleton key={i} className="h-28 w-full"/>))}
          </div>) : isError ? (<p className="text-sm text-destructive py-10 text-center">Failed to load daily income.</p>) : day && day.count === 0 ? (<div className="text-center text-muted-foreground py-10 border border-dashed rounded-md">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30"/>
            No payments recorded for this date
          </div>) : (<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-sm font-medium text-green-800 dark:text-green-200 flex items-center gap-2">
                      <Banknote className="h-4 w-4"/>
                      Cash Payments
                    </CardTitle>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">Cash on this date</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-green-900 dark:text-green-100" data-testid="text-daily-cash">
                    {formatCurrency(day?.cash ?? 0)}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div>
              <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-sm font-medium text-blue-800 dark:text-blue-200 flex items-center gap-2">
                      <CreditCard className="h-4 w-4"/>
                      Online Payments
                    </CardTitle>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Online on this date</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-blue-900 dark:text-blue-100" data-testid="text-daily-online">
                    {formatCurrency(day?.online ?? 0)}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div>
              <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-sm font-medium text-orange-800 dark:text-orange-200 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4"/>
                      Total Daily Income
                    </CardTitle>
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">All payments on this date</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-orange-900 dark:text-orange-100" data-testid="text-daily-total">
                    {formatCurrency(day?.total ?? 0)}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div>
              <Card className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-sm font-medium text-purple-800 dark:text-purple-200 flex items-center gap-2">
                      <Receipt className="h-4 w-4"/>
                      Number of Payments
                    </CardTitle>
                    <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Payments on this date</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-purple-900 dark:text-purple-100" data-testid="text-daily-count">
                    {day?.count ?? 0}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>)}

        {/* Last 7 days chart */}
        <div>
          <h3 className="font-medium text-sm text-muted-foreground mb-3">Last 7 Days Income</h3>
          {isLoading ? (<Skeleton className="h-44 w-full"/>) : isError ? (<p className="text-sm text-destructive py-10 text-center">Failed to load chart.</p>) : (<div className="flex items-end gap-2 sm:gap-3 h-44" data-testid="chart-last-7-days">
              {last7Days.map((dayItem) => {
                const height = dayItem.total > 0 ? Math.max(8, Math.round((dayItem.total / maxIncome) * 100)) : 0;
                return (<div key={dayItem.date} className="flex-1 min-w-0 h-full flex flex-col items-center gap-1" title={`${formatDate(dayItem.date)} - ${formatCurrency(dayItem.total)}`}>
                    <span className="text-[10px] sm:text-xs text-muted-foreground tabular-nums leading-none">
                      {dayItem.total > 0 ? formatIndianNumber(dayItem.total) : ""}
                    </span>
                    <div className="flex-1 w-full flex items-end">
                      <div className={`w-full rounded-t ${dayItem.total > 0 ? "bg-primary" : "bg-muted"}`} style={{ height: `${height}%` }}/>
                    </div>
                    <span className={`text-[10px] sm:text-xs tabular-nums ${dayItem.date === selectedDate ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                      {formatDate(dayItem.date).split("/").slice(0, 2).join("/")}
                    </span>
                  </div>);
              })}
            </div>)}
        </div>

        {/* Daily income history table */}
        {isLoading ? (<div className="space-y-3">
            {[...Array(5)].map((_, i) => (<Skeleton key={i} className="h-12 w-full"/>))}
          </div>) : isError ? (<p className="text-sm text-destructive py-10 text-center">Failed to load history.</p>) : (last7Days.length === 0 ? (<div className="text-center text-muted-foreground py-10 border border-dashed rounded-md">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30"/>
            No data available for the last 7 days
          </div>) : (<div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Cash</TableHead>
                  <TableHead>Online</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Payments</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {last7Days.map((dayItem) => (<TableRow key={dayItem.date} data-testid={`row-daily-${dayItem.date}`}>
                    <TableCell className="font-medium tabular-nums">{formatDate(dayItem.date)}</TableCell>
                    <TableCell className="tabular-nums">{formatCurrency(dayItem.cash)}</TableCell>
                    <TableCell className="tabular-nums">{formatCurrency(dayItem.online)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatCurrency(dayItem.total)}</TableCell>
                    <TableCell><Badge variant={dayItem.count > 0 ? "destructive" : "secondary"}>{dayItem.count}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setViewDate(dayItem.date)} data-testid={`button-view-payments-${dayItem.date}`}>
                        <Eye className="h-4 w-4 mr-1"/>
                        View Payments
                      </Button>
                    </TableCell>
                  </TableRow>))}
              </TableBody>
            </Table>
          </div>))}
      </CardContent>

      {/* View payments dialog */}
      <Dialog open={viewDate !== null} onOpenChange={(open) => !open && setViewDate(null)}>
        <DialogContent data-testid="dialog-view-payments">
          <DialogHeader>
            <DialogTitle>Payments on {viewDate ? formatDate(viewDate) : ""}</DialogTitle>
            <DialogDescription>Actual payment records for the selected date</DialogDescription>
          </DialogHeader>
          {viewLoading ? (<div className="space-y-3">
              {[...Array(4)].map((_, i) => (<Skeleton key={i} className="h-12 w-full"/>))}
            </div>) : viewError ? (<p className="text-sm text-destructive py-10 text-center">Failed to load payments.</p>) : visiblePayments.length === 0 ? (<div className="text-center text-muted-foreground py-10 border border-dashed rounded-md">
              <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30"/>
              No payments recorded for this date
            </div>) : (<div className="max-h-96 overflow-auto rounded-md border">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Mobile Number</TableHead>
                    <TableHead>Register No.</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePayments.map((payment) => (<TableRow key={payment.id} data-testid={`dialog-payment-${payment.id}`}>
                      <TableCell className="font-medium">{payment.studentName}</TableCell>
                      <TableCell className="tabular-nums">{payment.phone || "-"}</TableCell>
                      <TableCell>{payment.registerNo}</TableCell>
                      <TableCell>
                        <div className={`flex items-center gap-2 w-fit px-3 py-1 rounded-md ${payment.paymentMethod === "cash"
                    ? "bg-green-100 dark:bg-green-900/30"
                    : "bg-blue-100 dark:bg-blue-900/30"}`}>
                          {payment.paymentMethod === "cash" ? (<Banknote className="h-4 w-4 text-green-600 dark:text-green-400"/>) : (<CreditCard className="h-4 w-4 text-blue-600 dark:text-blue-400"/>)}
                          <span className={`text-sm font-medium capitalize ${payment.paymentMethod === "cash"
                    ? "text-green-700 dark:text-green-300"
                    : "text-blue-700 dark:text-blue-300"}`}>
                            {payment.paymentMethod}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCurrency(payment.amount)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditClick(payment)} data-testid={`button-edit-${payment.id}`}>
                            <Pencil className="h-4 w-4"/>
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteConfirmId(payment.id)} data-testid={`button-delete-${payment.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive"/>
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>))}
                </TableBody>
              </Table>
            </div>)}
        </DialogContent>
      </Dialog>

      {/* Edit payment dialog */}
      <Dialog open={editingPayment !== null} onOpenChange={(open) => !open && setEditingPayment(null)}>
        <DialogContent data-testid="dialog-edit-payment">
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
            <DialogDescription>Update payment details for {editingPayment?.studentName}</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="date" render={({ field }) => (<FormItem>
                    <FormLabel>Payment Date *</FormLabel>
                    <FormControl>
                      <DateInput value={field.value} onChange={(v) => field.onChange(v)} label="Payment Date" data-testid="input-payment-date" data-testid-calendar="calendar-payment-date"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>

              <FormField control={form.control} name="durationMonths" render={({ field }) => (<FormItem>
                    <FormLabel>Duration *</FormLabel>
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

              <FormField control={form.control} name="amount" render={({ field }) => (<FormItem>
                    <FormLabel>Amount (₹) *</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="Enter amount" value={field.value === 0 ? "" : field.value} onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value, 10) : 0)} data-testid="input-amount"/>
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

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingPayment(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit">
                  {updateMutation.isPending ? "Updating..." : "Update Payment"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>Are you sure you want to delete this payment? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate(deleteConfirmId)} disabled={deleteMutation.isPending} data-testid="button-confirm-delete">
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>);
}
