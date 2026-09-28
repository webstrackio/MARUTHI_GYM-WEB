import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose, } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Search, History, Banknote, CreditCard, Pencil, Trash2, MessageCircle, Check, AlertTriangle, Clock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { formatDate, todayString } from "@shared/dates";
// Receipt delivery state per payment row. `undefined` means the row predates the
// WhatsApp columns, which reads as "not attempted" - the same as `pending`.
const RECEIPT_STATE = {
  sent: { label: "Receipt sent", icon: Check, className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  failed: { label: "Receipt failed", icon: AlertTriangle, className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  skipped: { label: "Receipt skipped", icon: AlertTriangle, className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  sending: { label: "Sending receipt", icon: Clock, className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  pending: { label: "Receipt not sent", icon: MessageCircle, className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};
function getReceiptState(payment) {
  return RECEIPT_STATE[payment?.whatsappStatus] ?? RECEIPT_STATE.pending;
}
// Tooltip for a delivery the owner can see in a screenshot or a forwarded
// message. "Sent as image card" answers the question the badge alone cannot:
// whether the student really got the blue picture or the plain-text fallback.
function receiptDetail(payment) {
  if (payment?.whatsappStatus !== "sent" || !payment?.whatsappStyle) return null;
  return payment.whatsappStyle === "image"
    ? "Delivered as the blue image card"
    : "Delivered as plain text - the card could not be attached";
}
const editPaymentSchema = z.object({
    date: z.string().min(1, "Date is required"),
    durationMonths: z.number().min(1, "Duration is required"),
    amount: z.number().min(1, "Amount must be greater than 0"),
    paymentMethod: z.enum(["cash", "online"]),
});
export default function PaymentHistory() {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedMonth, setSelectedMonth] = useState(() => todayString().slice(0, 7));
    const [editingPayment, setEditingPayment] = useState(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const { toast } = useToast();
    const { data: payments, isLoading } = useQuery({
        queryKey: ["/api/payments"],
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
            queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
            queryClient.invalidateQueries({ queryKey: ["/api/income/stats"] });
            queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/income/daily") });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            toast({ title: "Payment updated successfully" });
            setIsDialogOpen(false);
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
            queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
            queryClient.invalidateQueries({ queryKey: ["/api/income/stats"] });
            queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/income/daily") });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            toast({ title: "Payment deleted successfully" });
            setDeleteConfirmId(null);
        },
        onError: (error) => {
            console.error("Delete payment failed:", error);
            toast({ title: error?.message || "Failed to delete payment", variant: "destructive" });
        },
    });
    const resendMutation = useMutation({
        mutationFn: (id) => apiRequest("POST", `/api/payments/${id}/whatsapp`),
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
            toast({ title: "WhatsApp receipt sent", description: result?.to ? `Delivered to +${result.to}` : undefined });
        },
        onError: (error) => {
            // The payment itself is untouched by a failed resend, so this is
            // reported as its own problem rather than as a payment failure.
            console.error("Resend receipt failed:", error);
            toast({ title: error?.message || "Could not send the receipt", description: "The payment is still recorded. Check the WhatsApp settings.", variant: "destructive" });
        },
    });
    const filteredPayments = payments?.filter((payment) => {
        const matchesSearch = payment.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            payment.registerNo.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesMonth = payment.date.startsWith(selectedMonth);
        return matchesSearch && matchesMonth;
    });
    const selectedMonthTotal = filteredPayments?.reduce((sum, p) => sum + p.amount, 0) ?? 0;
    const overallTotal = payments?.reduce((sum, p) => sum + p.amount, 0) ?? 0;
    const handleOpenDialog = (payment) => {
        setEditingPayment(payment);
        form.reset({
            date: payment.date,
            durationMonths: payment.duration,
            amount: payment.amount,
            paymentMethod: payment.paymentMethod,
        });
        setIsDialogOpen(true);
    };
    const onSubmit = (data) => {
        if (editingPayment) {
            updateMutation.mutate({ ...data, duration: data.durationMonths, id: editingPayment.id });
        }
    };
    return (<div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Payment History</h1>
        <p className="text-sm text-muted-foreground mt-1">View and manage all membership fee payments</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium text-orange-800 dark:text-orange-200 flex items-center gap-2">
                <TrendingUp className="h-4 w-4"/>
                Selected Month Total
              </CardTitle>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                {filteredPayments?.length ?? 0} payment(s) in the selected month
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-orange-900 dark:text-orange-100" data-testid="text-selected-month-total">
              {formatCurrency(selectedMonthTotal)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium text-green-800 dark:text-green-200 flex items-center gap-2">
                <TrendingUp className="h-4 w-4"/>
                Overall Total Income
              </CardTitle>
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                {payments?.length ?? 0} total payment(s) recorded
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-900 dark:text-green-100" data-testid="text-overall-total-income">
              {formatCurrency(overallTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment Records</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
              <Input placeholder="Search by name or register number..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-student"/>
            </div>
            <div className="sm:w-48">
              <Input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} data-testid="input-filter-month"/>
            </div>
          </div>

          {isLoading ? (<div className="space-y-3">
              {[...Array(5)].map((_, i) => (<Skeleton key={i} className="h-12 w-full"/>))}
            </div>) : filteredPayments && filteredPayments.length > 0 ? (<div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Token #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Register No.</TableHead>
                    <TableHead>Student Name</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Payment Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>WhatsApp Receipt</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayments.map((payment) => (<tr key={payment.id} data-testid={`row-payment-${payment.id}`}>
                      <TableCell className="font-medium">{payment.tokenNumber}</TableCell>
                      <TableCell>{formatDate(payment.date)}</TableCell>
                      <TableCell>{payment.registerNo}</TableCell>
                      <TableCell>{payment.studentName}</TableCell>
                      <TableCell>{payment.duration} month{payment.duration > 1 ? "s" : ""}</TableCell>
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
                      <TableCell className="text-right font-medium">{formatCurrency(payment.amount)}</TableCell>
                      <TableCell>
                        {(() => {
                            const state = getReceiptState(payment);
                            const Icon = state.icon;
                            return (<div className="flex flex-col items-start gap-1">
                              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${state.className}`} data-testid={`receipt-status-${payment.id}`} title={payment.whatsappError || receiptDetail(payment) || undefined}>
                                <Icon className="h-3.5 w-3.5"/>
                                <span>{state.label}</span>
                              </div>
                              {payment.whatsappStatus === "sent" && payment.whatsappStyle && (<span className="text-[10px] text-muted-foreground" data-testid={`receipt-style-${payment.id}`}>
                                {payment.whatsappStyle === "image" ? "Sent as image card" : "Sent as text"}
                              </span>)}
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => resendMutation.mutate(payment.id)} disabled={resendMutation.isPending} data-testid={`button-resend-receipt-${payment.id}`}>
                                {resendMutation.isPending && resendMutation.variables === payment.id ? "Sending..." : state.label === "Receipt sent" ? "Resend" : "Send receipt"}
                              </Button>
                            </div>);
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(payment)} data-testid={`button-edit-${payment.id}`}>
                            <Pencil className="h-4 w-4"/>
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteConfirmId(payment.id)} data-testid={`button-delete-${payment.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive"/>
                          </Button>
                        </div>
                      </TableCell>
                    </tr>))}
                </TableBody>
              </Table>
            </div>) : (<div className="text-center py-12 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-20"/>
              <p>No payment records found</p>
            </div>)}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent data-testid="dialog-edit-payment">
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
            <DialogDescription>
              Update payment details for {editingPayment?.studentName}
            </DialogDescription>
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
                      <Input type="number" placeholder="Enter amount" value={field.value === 0 ? "" : field.value} onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : 0)} data-testid="input-amount"/>
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
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Updating..." : "Update Payment"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
            <Button variant="destructive" onClick={() => {
            if (deleteConfirmId !== null) {
                deleteMutation.mutate(deleteConfirmId);
                setDeleteConfirmId(null);
            }
        }} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);
}
