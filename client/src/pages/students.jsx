import { useState, Fragment, useEffect, useRef, useLayoutEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Users, LogIn, AlertCircle, AlertTriangle, CheckCircle, Search, Sun, Moon, Phone, Share2, Dumbbell } from "lucide-react";
import { toBlob } from "html-to-image";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStudentSchema, normalizeBatch, normalizePhone } from "@shared/schema";
import { daysUntil, formatDate, formatTimeIST, parseDateString, todayString } from "@shared/dates";
import { buildWhatsAppHomeLink, openExternalUrl } from "@/lib/whatsapp";
import { useToday } from "@/hooks/use-today";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const formSchema = insertStudentSchema.omit({ expiryDate: true, registerNo: true }).extend({
    registerNo: z.string().optional(),
    name: z.string().min(1, "Name is required").regex(/^[A-Za-z][A-Za-z .'-]*$/, "Name must contain only letters"),
    phone: z.string().regex(/^[0-9]{10}$/, "Phone number must be exactly 10 digits"),
    address: z.string().min(1, "Address is required"),
    batch: z.enum(["morning", "evening"]),
});
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openWhatsAppWeb() {
    openExternalUrl("https://web.whatsapp.com/");
}
// The six card fields, built once so the popup and the shareable card image can
// never drift apart. Each row is null when the popup would not render it
// (missing date, missing time, ...). There is deliberately no plain-text
// equivalent any more: WhatsApp receives the card image alone, so a second
// "Maruthi Gym / Name: ... / Status: ..." text message is never built.
function buildCheckInRows(data) {
    return [
        data.name ? { label: "Name", value: data.name, tone: "default" } : null,
        data.date ? { label: "Date", value: formatDate(data.date), tone: "default" } : null,
        data.expiryDate ? { label: "Expiry", value: formatDate(data.expiryDate), tone: "default" } : null,
        data.paymentTime ? { label: "Time", value: formatTimeIST(data.paymentTime), tone: "default" } : null,
        (data.daysLeft !== null && data.daysLeft !== undefined)
            ? {
                label: "Days Left",
                value: `${Math.max(0, data.daysLeft)} days`,
                tone: Math.max(0, data.daysLeft) > 0 ? "positive" : "negative",
            }
            : null,
        data.status
            ? {
                label: "Status",
                value: data.status,
                tone: data.status === "ACTIVE" ? "positive" : "negative",
            }
            : null,
    ].filter(Boolean);
}
function buildAttendanceFeedbackData(payload) {
    return {
        name: payload.student?.name ?? null,
        date: payload.paymentDate ?? payload.student?.joinDate ?? todayString(),
        expiryDate: payload.student?.expiryDate ?? null,
        paymentTime: payload.paymentTime ?? null,
        daysLeft: typeof payload.daysLeft === "number" ? payload.daysLeft : null,
        status: typeof payload.isExpired === "boolean" ? (payload.isExpired ? "EXPIRED" : "ACTIVE") : null,
    };
}
// --- Shareable card metrics -------------------------------------------------
// The shared card is a fixed-format image, so `vw`/`%` units would resolve
// against the viewport rather than the card. Instead the card is *measured*:
// every value is `white-space: nowrap` with `flex-shrink: 0`, so the browser
// reports the natural width the rows actually need and the card is sized from
// that number. A long student name therefore widens the card instead of
// wrapping "12 days" or colliding with "ACTIVE", and nothing is ever clipped.
const CARD_PADDING_X = 24;
const CARD_MIN_WIDTH = 320;
const CARD_MIN_CONTENT_WIDTH = CARD_MIN_WIDTH - CARD_PADDING_X * 2;
const CARD_MAX_SCALE = 1.35;
// `intrinsicContentWidth` is measured at the base metrics (15px type, 24px
// padding) on the first layout pass. Text and padding both grow linearly with
// `scale`, so the measurement is scaled rather than re-measured, with a small
// margin so sub-pixel rounding can never clip a glyph. The scale never drops
// below 1 - type is not shrunk to force a fit, the card grows instead.
function computeCardMetrics(intrinsicContentWidth) {
    const base = Math.max(Math.ceil(intrinsicContentWidth), CARD_MIN_CONTENT_WIDTH);
    const scale = Math.min(CARD_MAX_SCALE, Math.max(1, base / CARD_MIN_CONTENT_WIDTH));
    return {
        width: Math.max(CARD_MIN_WIDTH, Math.ceil(base * scale * 1.02) + 2),
        scale,
    };
}
// Bounded type scale: the preferred size follows the card and clamp() keeps it
// inside a readable band instead of letting it drift.
function cardFontSize(base, scale) {
    return `clamp(${Math.round(base * 0.9)}px, ${(base * scale).toFixed(1)}px, ${Math.round(base * 1.35)}px)`;
}
function cardSpacing(base, scale) {
    return `${(base * scale).toFixed(1)}px`;
}
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
                return <TableCell>{formatDate(student.joinDate)}</TableCell>;
            case "Expiry Date":
                return (<TableCell>
            {student.expiryDate ? formatDate(student.expiryDate) : "-"}
          </TableCell>);
            case "Batch":
                return (<TableCell>
            <Badge variant="outline" className={normalizeBatch(student.batch) === "morning"
                        ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700"
                        : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700"}>
              {normalizeBatch(student.batch) === "morning" ? "Morning" : "Evening"}
            </Badge>
          </TableCell>);
            case "Days Left":
                return (<TableCell className={status === "Active"
                        ? "text-green-600 dark:text-green-400 font-medium"
                        : status === "Pay Required" || status === "Expiring Today"
                            ? "text-orange-600 dark:text-orange-400 font-medium"
                            : "text-red-600 dark:text-red-400 font-medium"}>
            Days Left: {getDaysLeft(student.expiryDate)}
          </TableCell>);
            case "Status":
                return (<TableCell>
            <Badge variant={status === "Active" ? "default" : "destructive"} className={status === "Active"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        : status === "Expiring Today"
                            ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
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
    const today = useToday();
    const todayDate = parseDateString(today);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingStudent, setEditingStudent] = useState(null);
    const [attendanceFeedback, setAttendanceFeedback] = useState(null);
    const welcomeCardRef = useRef(null);
    const checkInCardRef = useRef(null);
    const checkInContentRef = useRef(null);
    const [checkInCardMetrics, setCheckInCardMetrics] = useState(null);
    // Size the shareable card from its own content. Runs before paint so the
    // html-to-image capture never sees a card that is still being laid out.
    useLayoutEffect(() => {
        if (attendanceFeedback?.type !== "warning" || !checkInContentRef.current) {
            return;
        }
        setCheckInCardMetrics(computeCardMetrics(checkInContentRef.current.scrollWidth));
    }, [attendanceFeedback]);
    const validateImageBlob = (blob) => new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const ok = img.naturalWidth > 0 && img.naturalHeight > 0;
            URL.revokeObjectURL(url);
            resolve(ok);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(false);
        };
        img.src = url;
    });
    // Rasterizes a DOM node to a validated PNG, so a blank/unsupported render
    // is rejected instead of being shared as an empty image.
    const renderNodeToImage = async (node, backgroundColor) => {
        if (!node)
            return null;
        if (document.fonts?.ready) {
            await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const blob = await toBlob(node, {
            pixelRatio: 2,
            cacheBust: true,
            skipFonts: true,
            backgroundColor,
        });
        if (!blob || blob.size < 512)
            return null;
        const valid = await validateImageBlob(blob);
        return valid ? blob : null;
    };
    const generateCardImage = async () => {
        return renderNodeToImage(welcomeCardRef.current, "#111827");
    };
    const generateCheckInCardImage = async () => {
        return renderNodeToImage(checkInCardRef.current, "#ffffff");
    };
    const handleShareFeedback = async () => {
        if (!attendanceFeedback?.data)
            return;
        let blob = null;
        try {
            blob = await generateCardImage();
        }
        catch (_err) {
            blob = null;
        }
        if (!blob) {
            toast({ title: "Unable to generate Maruthi Gym card. Please try again.", variant: "destructive" });
            return;
        }
        const file = new File([blob], "maruthi-gym-card.png", { type: "image/png" });
        if (typeof navigator.share === "function" && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: "Maruthi Gym" });
                return;
            }
            catch (err) {
                if (err?.name === "AbortError")
                    return;
            }
        }
        let copied = false;
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
            try {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                copied = true;
            }
            catch (_err) {
                copied = false;
            }
        }
        openWhatsAppWeb();
        if (copied) {
            toast({ title: "Card image copied", description: "Paste the card image into the open WhatsApp Web chat" });
        }
        else {
            downloadBlob(blob, "maruthi-gym-card.png");
            toast({ title: "Card image downloaded", description: "Attach the downloaded card image into the open WhatsApp Web chat" });
        }
    };
    // WhatsApp sharing for the "Already Checked In" popup. The card image is the
    // one and only thing that is ever handed to WhatsApp: it is rasterized from
    // the same DOM the popup renders, so it already carries the "Already Checked
    // In" banner plus every field. Nothing else is attached - no `text` member
    // on the share and no pre-filled deep link - because WhatsApp delivers an
    // image plus text as two separate messages, which showed the gym owner the
    // same details twice. The member's number is never attached either, so
    // WhatsApp still opens its own contact/group picker.
    const handleShareAlreadyCheckedIn = async () => {
        let blob = null;
        try {
            blob = await generateCheckInCardImage();
        }
        catch (_err) {
            blob = null;
        }
        // A failed rasterization sends nothing at all. There is deliberately no
        // plain-text fallback here: it would either duplicate a card that was
        // already sent, or silently reach WhatsApp as a text-only message
        // dressed up as the card. Retry instead.
        if (!blob) {
            toast({ title: "Unable to generate the check-in card", description: "Nothing was sent to WhatsApp. Please try again.", variant: "destructive" });
            return;
        }
        const file = new File([blob], "maruthi-gym-check-in.png", { type: "image/png" });
        if (typeof navigator.share === "function" && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: "Maruthi Gym" });
                return;
            }
            catch (err) {
                if (err?.name === "AbortError")
                    return;
            }
        }
        // No file sharing available (desktop browsers mostly): hand the card
        // over on the clipboard and open WhatsApp empty, so the owner only ever
        // pastes the single card image into the chat they pick.
        let copied = false;
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
            try {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                copied = true;
            }
            catch (_err) {
                copied = false;
            }
        }
        openExternalUrl(buildWhatsAppHomeLink());
        if (copied) {
            toast({ title: "Card image copied", description: "Pick a chat in WhatsApp and paste the card image" });
        }
        else {
            downloadBlob(blob, "maruthi-gym-check-in.png");
            toast({ title: "Card image downloaded", description: "Pick a chat in WhatsApp and attach the downloaded card" });
        }
    };
    const [duplicateStudent, setDuplicateStudent] = useState(null);
    const parseApiError = (error) => {
        try {
            const text = error.message?.slice(error.message.indexOf(": ") + 2);
            return text ? JSON.parse(text) : null;
        }
        catch {
            return null;
        }
    };
    const { toast } = useToast();
    const { data: studentsData, isLoading } = useQuery({
        queryKey: ["/api/students"],
    });
    const students = studentsData ? [...studentsData].reverse() : undefined;
    const [, navigate] = useLocation();
    const search = useSearch();
    const searchParams = new URLSearchParams(search);
    const statusFilter = searchParams.get("status");
    const memberIdFilter = searchParams.get("memberId");
    const [activeTab, setActiveTab] = useState(() => {
        if (statusFilter === "active")
            return "active";
        if (statusFilter === "expired")
            return "expired";
        return "all";
    });
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedBatch, setSelectedBatch] = useState("all");
    // `?memberId=` deep-links straight from the Dashboard's expired-member
    // cards. Filtering by register number keeps that member as the only row on
    // screen, in whichever tab the link asked for.
    const memberIdRef = useRef(null);
    useEffect(() => {
        if (!memberIdFilter) {
            memberIdRef.current = null;
            return;
        }
        if (!students)
            return;
        if (memberIdRef.current === memberIdFilter)
            return;
        const member = students.find((s) => String(s.id) === memberIdFilter);
        if (!member)
            return;
        memberIdRef.current = memberIdFilter;
        setSearchQuery(member.registerNo);
    }, [memberIdFilter, students]);
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            registerNo: "",
            name: "",
            phone: "",
            address: "",
            joinDate: todayString(),
            batch: "morning",
        },
    });
    const createMutation = useMutation({
        mutationFn: (data) => apiRequest("POST", "/api/students", data),
        onSuccess: async (response) => {
            const createdStudent = await response.json();
            await queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            toast({ title: "Student added successfully" });
            setIsDialogOpen(false);
            form.reset();
            navigate(`/payments?studentId=${createdStudent.id}`);
        },
        onError: (error) => {
            const body = parseApiError(error);
            if (body?.conflict && body.student) {
                setDuplicateStudent(body.student);
                return;
            }
            toast({ title: body?.error || "Failed to add student", variant: "destructive" });
        },
    });
    const updateMutation = useMutation({
        mutationFn: ({ id, ...data }) => apiRequest("PATCH", `/api/students/${id}`, data),
        onSuccess: async (_response, variables) => {
            await queryClient.invalidateQueries({ queryKey: ["/api/students"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
            await queryClient.refetchQueries({ queryKey: ["/api/students"] });
            toast({ title: "Student updated successfully" });
            setIsDialogOpen(false);
            setEditingStudent(null);
            form.reset();
            navigate(`/payments?studentId=${variables.id}`);
        },
        onError: (error) => {
            const body = parseApiError(error);
            if (body?.conflict && body.student) {
                setDuplicateStudent(body.student);
            }
            else {
                toast({ title: body?.error || "Failed to update student", variant: "destructive" });
            }
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
                data: buildAttendanceFeedbackData(data),
            });
        },
        onError: (error) => {
            try {
                const body = error.message.slice(error.message.indexOf(": ") + 2);
                const errorData = JSON.parse(body);
                setAttendanceFeedback({
                    type: errorData.type || "not_found",
                    message: errorData.message,
                    data: buildAttendanceFeedbackData(errorData),
                });
            }
            catch {
                setAttendanceFeedback({
                    type: "not_found",
                    message: "Student not found",
                    data: {
                        name: null,
                        date: todayString(),
                        expiryDate: null,
                        paymentTime: null,
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
                batch: normalizeBatch(student.batch),
            });
        }
        else {
            setEditingStudent(null);
            form.reset({
                registerNo: "",
                name: "",
                phone: "",
                address: "",
                joinDate: todayString(),
                batch: selectedBatch === "all" ? "morning" : selectedBatch,
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
        if (createMutation.isPending || updateMutation.isPending)
            return;
        const payload = { ...data, phone: normalizePhone(data.phone) };
        if (editingStudent) {
            updateMutation.mutate({ ...payload, id: editingStudent.id });
        }
        else {
            createMutation.mutate(payload);
        }
    };
    const handleViewDuplicateStudent = () => {
        const id = duplicateStudent?.id;
        setDuplicateStudent(null);
        if (!id)
            return;
        setIsDialogOpen(false);
        form.reset();
        navigate(`/payments?studentId=${id}`);
    };
    const getStatus = (expiryDate) => {
        if (!expiryDate)
            return "Pay Required";
        const remaining = daysUntil(expiryDate, todayDate);
        if (remaining < 0)
            return "Expired";
        if (remaining === 0)
            return "Expiring Today";
        return "Active";
    };
    const getDaysLeft = (expiryDate) => {
        return Math.max(0, daysUntil(expiryDate, todayDate));
    };
    const canCheckIn = (expiryDate) => {
        const daysLeft = getDaysLeft(expiryDate);
        return daysLeft > 0;
    };
    const batchLabel = selectedBatch === "morning" ? "Morning Batch" : selectedBatch === "evening" ? "Evening Batch" : "All Batches";
    const searchLower = searchQuery.trim().toLowerCase();
    const batchFilteredStudents = students?.filter((s) => {
        if (selectedBatch === "all")
            return true;
        return normalizeBatch(s.batch) === selectedBatch;
    });
    const filteredStudents = batchFilteredStudents?.filter((s) => {
        if (!searchLower)
            return true;
        return (s.name.toLowerCase().includes(searchLower) ||
            s.registerNo.toLowerCase().includes(searchLower));
    });
    const allStudents = filteredStudents;
    const activeStudents = filteredStudents?.filter((s) => getStatus(s.expiryDate) === "Active");
    const expiredStudents = filteredStudents?.filter((s) => {
        const status = getStatus(s.expiryDate);
        return status === "Expired" || status === "Pay Required" || status === "Expiring Today";
    });
    return (<div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage gym members</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {statusFilter && (<Button variant="outline" onClick={() => {
                setActiveTab("all");
                setSearchQuery("");
                navigate("/students");
            }} data-testid="button-show-all-students">
              Show All
            </Button>)}
          <Button onClick={() => handleOpenDialog()} data-testid="button-add-student" className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4"/>
            Add Student
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search members by name or register number..." className="pl-10" data-testid="input-search-students"/>
      </div>

      {/* Batch Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-sm font-bold text-foreground">Batch:</span>
        <div className="flex flex-1 sm:flex-none rounded-full border bg-muted p-1 gap-1">
          <button
            onClick={() => setSelectedBatch("all")}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-full px-3 sm:px-4 py-1.5 text-sm font-medium transition-all duration-150 active:scale-95 ${selectedBatch === "all"
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"}`}
            data-testid="button-batch-all"
          >
            <span>All</span>
          </button>
          <button
            onClick={() => setSelectedBatch("morning")}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-full px-3 sm:px-4 py-1.5 text-sm font-medium transition-all duration-150 active:scale-95 ${selectedBatch === "morning"
              ? "bg-orange-500 text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground"}`}
            data-testid="button-batch-morning"
          >
            <Sun className="h-3.5 w-3.5"/>
            <span className="hidden xs:inline">Morning Batch</span>
            <span className="xs:hidden">Morning</span>
          </button>
          <button
            onClick={() => setSelectedBatch("evening")}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-full px-3 sm:px-4 py-1.5 text-sm font-medium transition-all duration-150 active:scale-95 ${selectedBatch === "evening"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground"}`}
            data-testid="button-batch-evening"
          >
            <Moon className="h-3.5 w-3.5"/>
            <span className="hidden xs:inline">Evening Batch</span>
            <span className="xs:hidden">Evening</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (<div className="space-y-3">
          {[...Array(5)].map((_, i) => (<Skeleton key={i} className="h-12 w-full"/>))}
        </div>) : (<div className="space-y-4 sm:space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex sm:inline-flex h-auto w-full sm:w-auto gap-1 rounded-full border bg-muted p-1">
              <TabsTrigger value="all" data-testid="tab-students-all" className="flex-1 sm:flex-none rounded-full px-3 py-1 text-sm">
                All
              </TabsTrigger>
              <TabsTrigger value="active" data-testid="tab-students-active" className="flex-1 sm:flex-none rounded-full px-3 py-1 text-sm">
                Active
              </TabsTrigger>
              <TabsTrigger value="expired" data-testid="tab-students-expired" className="flex-1 sm:flex-none rounded-full px-3 py-1 text-sm">
                Expired
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-4">
              <MemberCard title={`All Members \u2014 ${batchLabel}`} description={`${allStudents?.length ?? 0} total member(s)`} students={allStudents} columns={["Register No.", "Name", "Batch", "Address", "Phone", "Join Date", "Expiry Date", "Status", "Actions"]} getStatus={getStatus} getDaysLeft={getDaysLeft} canCheckIn={canCheckIn} onCheckIn={(registerNo) => attendanceMutation.mutate(registerNo)} onEdit={handleOpenDialog} isCheckInPending={attendanceMutation.isPending} emptyText="No members found. Add your first member to get started."/>
            </TabsContent>

            <TabsContent value="active" className="mt-4">
              <MemberCard title={`Active Members \u2014 ${batchLabel}`} description={`${activeStudents?.length ?? 0} active member(s)`} students={activeStudents} columns={["Register No.", "Name", "Batch", "Phone", "Address", "Join Date", "Expiry Date", "Days Left", "Status", "Actions"]} getStatus={getStatus} getDaysLeft={getDaysLeft} canCheckIn={canCheckIn} onCheckIn={(registerNo) => attendanceMutation.mutate(registerNo)} onEdit={handleOpenDialog} isCheckInPending={attendanceMutation.isPending} emptyText="No active members right now."/>
            </TabsContent>

            <TabsContent value="expired" className="mt-4">
              <MemberCard title={`Expired Members \u2014 ${batchLabel}`} description={`${expiredStudents?.length ?? 0} expired / expiring today / unpaid member(s)`} students={expiredStudents} columns={["Register No.", "Name", "Batch", "Phone", "Address", "Join Date", "Expiry Date", "Days Left", "Status", "Actions"]} getStatus={getStatus} getDaysLeft={getDaysLeft} canCheckIn={canCheckIn} onCheckIn={(registerNo) => attendanceMutation.mutate(registerNo)} onEdit={handleOpenDialog} isCheckInPending={attendanceMutation.isPending} emptyText="No expired, expiring today, or unpaid members."/>
            </TabsContent>
          </Tabs>
        </div>)}

      {/* Add/Edit Student Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg w-[calc(100%-2rem)] sm:w-full" data-testid="dialog-student-form">
          <DialogHeader>
            <DialogTitle>{editingStudent ? "Edit Student" : "Add New Student"}</DialogTitle>
            <DialogDescription>
              {editingStudent ? "Update student information" : "Enter student details to register"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="registerNo" render={({ field }) => (<FormItem>
                    <FormLabel>Register Number <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} disabled readOnly placeholder="Auto-generated" data-testid="input-register-no"/>
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Auto-generated by the system.</p>
                    <FormMessage />
                  </FormItem>)}/>
              <FormField control={form.control} name="batch" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Batch <span className="text-red-500">*</span></FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-batch">
                            <SelectValue placeholder="Select Batch"/>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="morning">Morning Batch</SelectItem>
                          <SelectItem value="evening">Evening Batch</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}/>
              </div>
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem>
                    <FormLabel>Full Name <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={50} placeholder="Enter full name" onChange={(e) => field.onChange(e.target.value.replace(/[^A-Za-z .'-]/g, ""))} data-testid="input-name"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="phone" render={({ field }) => (<FormItem>
                    <FormLabel>Phone <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="numeric" maxLength={10} placeholder="10 digit mobile number" onChange={(e) => field.onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} data-testid="input-phone"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>
              <FormField control={form.control} name="joinDate" render={({ field }) => (<FormItem>
                    <FormLabel>Join Date <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <DateInput value={field.value} onChange={(v) => field.onChange(v)} label="Join Date" data-testid="input-join-date" data-testid-calendar="calendar-join-date"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>
              </div>
              <FormField control={form.control} name="address" render={({ field }) => (<FormItem>
                    <FormLabel>Address <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Enter address" {...field} data-testid="input-address"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>)}/>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-student" className="w-full sm:w-auto">
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingStudent ? "Update" : "Add Student"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Duplicate Phone Number Dialog */}
      <Dialog open={duplicateStudent !== null} onOpenChange={(open) => !open && setDuplicateStudent(null)}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] sm:w-full" data-testid="dialog-duplicate-student">
          {duplicateStudent && (<div className="space-y-6">
              <div className="text-center">
                <AlertTriangle className="h-16 w-16 text-amber-500 mx-auto"/>
                <h2 className="text-2xl font-bold text-amber-600 dark:text-amber-400">Student Already Exists</h2>
                <p className="text-sm text-muted-foreground mt-1">This phone number is already registered.</p>
              </div>

              <div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-900/30 space-y-3">
                <div className="flex justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-400">Name:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100 text-right">{duplicateStudent.name}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-400">Register No.:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{duplicateStudent.registerNo}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-400"><Phone className="h-3.5 w-3.5 inline mr-1"/></span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{duplicateStudent.phone}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-400">Batch:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{normalizeBatch(duplicateStudent.batch) === "morning" ? "Morning" : "Evening"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-400">Address:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100 text-right">{duplicateStudent.address}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-gray-600 dark:text-gray-400">Status:</span>
                  <Badge variant={getStatus(duplicateStudent.expiryDate) === "Active" ? "default" : "destructive"} className={getStatus(duplicateStudent.expiryDate) === "Active"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        : getStatus(duplicateStudent.expiryDate) === "Expiring Today"
                            ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                            : getStatus(duplicateStudent.expiryDate) === "Pay Required"
                                ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                                : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"} data-testid="badge-duplicate-status">
                    {getStatus(duplicateStudent.expiryDate)}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleViewDuplicateStudent} className="flex-1" data-testid="button-view-student">
                  View Student
                </Button>
                <Button variant="outline" onClick={() => setDuplicateStudent(null)} className="flex-1" data-testid="button-cancel-duplicate">
                  Cancel
                </Button>
              </div>
            </div>)}
        </DialogContent>
      </Dialog>

      {/* Shareable "Already Checked In" card. Rendered off-screen so
          html-to-image can rasterize it. Its width comes from the measured
          content, the height is content-based, and every colour is an explicit
          value so the exported PNG is identical in light and dark mode. */}
      {attendanceFeedback?.type === "warning" && (() => {
        const scale = checkInCardMetrics?.scale ?? 1;
        const rows = buildCheckInRows(attendanceFeedback.data);
        return (
          <div className="pointer-events-none fixed left-[-9999px] top-0" aria-hidden="true">
            <div
              ref={checkInCardRef}
              className="shadow-2xl"
              style={{
                  backgroundColor: "#ffffff",
                  boxSizing: "border-box",
                  borderRadius: cardSpacing(16, scale),
                  // max-content on the first pass exposes the natural width to
                  // measure; afterwards it is locked to that width so no value
                  // can ever wrap. Height is left content-based.
                  width: checkInCardMetrics ? checkInCardMetrics.width : "max-content",
                  minWidth: CARD_MIN_WIDTH,
              }}
              data-testid="check-in-card-preview"
            >
              <div ref={checkInContentRef} style={{ width: checkInCardMetrics ? "100%" : "max-content" }}>
                <div style={{ display: "flex", alignItems: "center", columnGap: cardSpacing(10, scale), backgroundColor: "#065f46", padding: `${cardSpacing(17, scale)} ${cardSpacing(CARD_PADDING_X, scale)}`, borderTopLeftRadius: cardSpacing(16, scale), borderTopRightRadius: cardSpacing(16, scale) }}>
                  <Dumbbell style={{ color: "#ffffff", width: cardSpacing(20, scale), height: cardSpacing(20, scale), flexShrink: 0 }}/>
                  <span style={{ color: "#ffffff", fontSize: cardFontSize(19, scale), fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>Maruthi Gym</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", columnGap: cardSpacing(8, scale), backgroundColor: "#fee2e2", padding: `${cardSpacing(10, scale)} ${cardSpacing(CARD_PADDING_X, scale)}` }}>
                  <AlertTriangle style={{ color: "#b91c1c", width: cardSpacing(16, scale), height: cardSpacing(16, scale), flexShrink: 0 }}/>
                  <span style={{ color: "#b91c1c", fontSize: cardFontSize(14, scale), fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>Already Checked In</span>
                </div>
                <div style={{ padding: `${cardSpacing(20, scale)} ${cardSpacing(CARD_PADDING_X, scale)}`, borderBottomLeftRadius: cardSpacing(16, scale), borderBottomRightRadius: cardSpacing(16, scale) }}>
                  {rows.map((row, index) => (
                    <div
                      key={row.label}
                      style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          columnGap: cardSpacing(20, scale),
                          paddingBottom: index === rows.length - 1 ? 0 : cardSpacing(12, scale),
                          marginBottom: index === rows.length - 1 ? 0 : cardSpacing(12, scale),
                          borderBottom: index === rows.length - 1 ? "none" : `1px solid ${cardSpacing(1, scale)} #f1f5f9`,
                      }}
                    >
                      <span style={{ color: "#64748b", fontSize: cardFontSize(15, scale), fontWeight: 400, whiteSpace: "nowrap", flexShrink: 0 }}>{row.label}</span>
                      <span style={{ color: row.tone === "positive" ? "#15803d" : row.tone === "negative" ? "#b91c1c" : "#0f172a", fontSize: cardFontSize(15, scale), fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, textAlign: "right" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Attendance Feedback Dialog */}
      <Dialog open={attendanceFeedback !== null} onOpenChange={(open) => !open && setAttendanceFeedback(null)}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] sm:w-full" data-testid={`feedback-${attendanceFeedback?.type}`}>
          {attendanceFeedback && (<>
          <div ref={welcomeCardRef} className="space-y-6">
              <div className="text-center">
                {attendanceFeedback.type === "success" ? (<div className="space-y-3">
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto"/>
                    <h2 className="text-2xl font-bold text-green-600 dark:text-green-400">Maruthi Gym</h2>
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
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{formatDate(attendanceFeedback.data.date)}</span>
                    </div>)}
                  {attendanceFeedback.data.expiryDate && (<div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Expiry:</span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{formatDate(attendanceFeedback.data.expiryDate)}</span>
                    </div>)}
                  {attendanceFeedback.data.paymentTime && (<div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Time:</span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{formatTimeIST(attendanceFeedback.data.paymentTime)}</span>
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
            </div>
            {(attendanceFeedback.type === "success" || attendanceFeedback.type === "warning") && (
            <button type="button" onClick={attendanceFeedback.type === "success" ? handleShareFeedback : handleShareAlreadyCheckedIn} className={`absolute right-12 top-4 rounded-sm p-1 transition-all duration-150 hover:scale-110 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none ${attendanceFeedback.type === "success"
              ? "text-muted-foreground opacity-70 ring-offset-background"
              : "text-green-600 dark:text-green-400"}`} aria-label="Share via WhatsApp" title="Share via WhatsApp" data-testid={attendanceFeedback.type === "success" ? "button-share-feedback" : "button-share-warning"}>
              <Share2 className="h-4 w-4"/>
            </button>)}
          </>)}
        </DialogContent>
      </Dialog>
    </div>);
}
