import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CalendarX, MessageSquare, Phone, Send, User, Wallet } from "lucide-react";
import { buildWhatsAppBulkText, buildWhatsAppDirectLink, buildWhatsAppHomeLink, buildWhatsAppMessage, copyToClipboard, getDefaultWhatsAppMessageType, getWhatsAppMessageTypes, memberHasPayment, openExternalUrl } from "@/lib/whatsapp";
const BULK_SEPARATOR_NOTE = "Each message is separated by a divider so it can be pasted into the right chat.";
// Pill picker, styled like the batch selector in the Students page: the active
// option is inverted so the current choice is readable at a glance.
function MessageTypePicker({ types, value, onChange, testIdPrefix }) {
    return (<div className="flex w-full max-w-full box-border flex-wrap gap-1 rounded-full border bg-muted p-1 max-[480px]:grid max-[480px]:grid-cols-1 max-[480px]:gap-1.5" data-testid={`${testIdPrefix}-message-types`}>
        {types.map((template) => (<button
            key={template.id}
            type="button"
            onClick={() => onChange(template.id)}
            aria-pressed={value === template.id}
            // Mobile (<=480px) becomes a single-column grid so every pill lines up
            // on one edge instead of leaving a ragged right gap: the widest label
            // is ~196px inside a ~238px box, so content-sized pills leave ~40px of
            // dead space on every row. `min-w-0 max-w-full` keeps each pill inside
            // the box even if a future label is longer than the container.
            // The selected white pill styling is deliberately unchanged.
            className={`inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium break-words transition-all duration-150 active:scale-95 max-[480px]:w-full ${value === template.id
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"}`}
            data-testid={`${testIdPrefix}-message-type-${template.id}`}
        >
            <span aria-hidden="true">{template.emoji}</span>
            <span>{template.label}</span>
        </button>))}
    </div>);
}
function MessagePreview({ children, testId, className = "max-h-56" }) {
    return (<div className={`${className} overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words`} data-testid={testId}>
        {children}
    </div>);
}
function CustomMessageInput({ value, onChange }) {
    return (<div className="space-y-1.5">
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            placeholder="Type the message you want to send..."
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="input-whatsapp-custom-message"
        />
        <p className="text-xs text-muted-foreground">Leave a blank line between paragraphs. Nothing is sent until you press Open WhatsApp.</p>
    </div>);
}
// Per-member popup opened from a single expired member card.
export function WhatsAppMessageDialog({ open, onOpenChange, member, gymName }) {
    const { toast } = useToast();
    const hasPayment = memberHasPayment(member);
    const types = getWhatsAppMessageTypes(hasPayment);
    const [messageType, setMessageType] = useState(() => getDefaultWhatsAppMessageType(hasPayment));
    const [customMessage, setCustomMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    useEffect(() => {
        if (!open) {
            setIsSending(false);
            return;
        }
        setMessageType(getDefaultWhatsAppMessageType(hasPayment));
        setCustomMessage("");
    }, [open, member?.id]);
    const message = useMemo(() => buildWhatsAppMessage({
        type: messageType,
        name: member?.name,
        gymName,
        customMessage,
    }), [messageType, member?.name, gymName, customMessage]);
    const canSend = Boolean(member?.phone) && message.length > 0;
    const handleCopy = async () => {
        if (!message)
            return;
        const copied = await copyToClipboard(message);
        toast(copied
            ? { title: "Message copied", description: "Paste it into the member's WhatsApp chat" }
            : { title: "Unable to copy automatically", description: "Select the message preview and copy it manually", variant: "destructive" });
    };
    const handleSend = async () => {
        if (!canSend || isSending)
            return;
        setIsSending(true);
        try {
            // `message` is the preview text and nothing else. The member's saved
            // phone number is the destination, and the message-type label, the
            // status line and the rest of this popup are never part of the link,
            // so the member only ever sees the rendered message. The text is
            // copied first as a safety net: if WhatsApp never opens, the owner
            // still has the message to paste by hand.
            const copied = await copyToClipboard(message);
            openExternalUrl(buildWhatsAppDirectLink(member.phone, message));
            toast({
                title: `WhatsApp opened for ${member.name}`,
                description: copied
                    ? "Tap send in WhatsApp to deliver the message"
                    : "Copy failed, so select the preview and send it manually",
            });
        }
        finally {
            setIsSending(false);
        }
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
            className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 max-w-lg w-[calc(100%-2rem)] sm:w-full"
            data-testid="dialog-whatsapp-message"
        >
            {/* Fixed header, scrollable body, fixed footer. `flex-col` + `gap-0`
                overrides the shared dialog's `grid`, and `min-h-0 flex-1` on the
                body is what lets it shrink and scroll instead of pushing the
                action buttons off the bottom of short screens. */}
            <DialogHeader className="shrink-0 border-b bg-background p-6 pb-4 pr-12">
                <DialogTitle>Send WhatsApp Message</DialogTitle>
                <DialogDescription>
                    {hasPayment ? "Membership expired" : "Membership payment not completed"}
                </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-6" data-testid="whatsapp-dialog-body">
                <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm" data-testid="whatsapp-member-summary">
                    <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground shrink-0"/>
                        <span className="font-semibold text-foreground truncate">{member?.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground shrink-0"/>
                        <span className="text-muted-foreground" data-testid="whatsapp-member-phone">{member?.phone || "No phone number"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasPayment
                            ? <CalendarX className="h-4 w-4 text-red-500 shrink-0"/>
                            : <Wallet className="h-4 w-4 text-orange-500 shrink-0"/>}
                        <span className={hasPayment ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"}>
                            {hasPayment ? "Membership expired" : "Payment not completed yet"}
                        </span>
                    </div>
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Message type</p>
                    <MessageTypePicker types={types} value={messageType} onChange={setMessageType} testIdPrefix="whatsapp"/>
                </div>
                {messageType === "custom" && <CustomMessageInput value={customMessage} onChange={setCustomMessage}/>}
                <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Message preview</p>
                    {message
                        ? <MessagePreview testId="whatsapp-message-preview">{message}</MessagePreview>
                        : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="whatsapp-message-empty">Type a message to see the preview.</p>}
                    <p className="text-xs text-muted-foreground" data-testid="whatsapp-send-hint">
                        Only the text above is sent to {member?.phone || "this member"} on WhatsApp. The message type and this popup are not included.
                    </p>
                </div>
                {!member?.phone && <p className="text-xs text-red-600 dark:text-red-400">This member has no phone number on record, so WhatsApp cannot be opened. Copy the message instead.</p>}
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t bg-background p-4 sm:justify-between">
                <Button variant="outline" onClick={handleCopy} disabled={!message || isSending} data-testid="button-whatsapp-copy">
                    <MessageSquare className="h-4 w-4"/>
                    Copy
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSending} data-testid="button-whatsapp-cancel">
                        Cancel
                    </Button>
                    <Button onClick={handleSend} disabled={!canSend || isSending} className="bg-green-600 hover:bg-green-700 text-white" data-testid="button-whatsapp-send">
                        <Send className="h-4 w-4"/>
                        {isSending ? "Opening WhatsApp..." : "Send WhatsApp"}
                    </Button>
                </div>
            </DialogFooter>
        </DialogContent>
    </Dialog>);
}
// Confirmation popup for "Message All". WhatsApp cannot be scripted, so this
// never sends anything by itself: it copies every personalised message and
// opens WhatsApp, leaving the owner to paste each one into the right chat.
export function WhatsAppBulkDialog({ open, onOpenChange, members, gymName }) {
    const { toast } = useToast();
    const recipients = members ?? [];
    const unpaidCount = recipients.filter((member) => !memberHasPayment(member)).length;
    const types = getWhatsAppMessageTypes(null);
    const [messageType, setMessageType] = useState("expired");
    const [customMessage, setCustomMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    useEffect(() => {
        if (!open) {
            setIsSending(false);
            return;
        }
        setMessageType("expired");
        setCustomMessage("");
    }, [open]);
    const entries = useMemo(() => recipients.map((member) => {
        // Members who never paid would be told their membership expired, which
        // is not what happened to them, so they get the pending wording instead.
        const type = messageType === "custom" || memberHasPayment(member) ? messageType : "pending";
        return {
            id: member.id,
            name: member.name,
            message: buildWhatsAppMessage({ type, name: member.name, gymName, customMessage }),
        };
    }), [recipients, messageType, gymName, customMessage]);
    const bulkText = buildWhatsAppBulkText(entries);
    const canSend = bulkText.length > 0;
    const handleSend = async () => {
        if (!canSend || isSending)
            return;
        setIsSending(true);
        try {
            const copied = await copyToClipboard(bulkText);
            openExternalUrl(buildWhatsAppHomeLink());
            toast(copied
                ? { title: `${recipients.length} message${recipients.length === 1 ? "" : "s"} copied`, description: "Paste each one into the matching WhatsApp chat" }
                : { title: "Unable to copy automatically", description: "Select the message list and copy it manually", variant: "destructive" });
        }
        finally {
            setIsSending(false);
        }
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
            className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 max-w-lg w-[calc(100%-2rem)] sm:w-full"
            data-testid="dialog-whatsapp-all"
        >
            <DialogHeader className="shrink-0 border-b bg-background p-6 pb-4 pr-12">
                <DialogTitle>Message All Expired Members</DialogTitle>
                <DialogDescription>
                    Nothing is sent automatically. Review the list, then open WhatsApp and paste each message into the right chat.
                </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-6" data-testid="whatsapp-bulk-body">
                <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1" data-testid="whatsapp-bulk-summary">
                    <p className="font-semibold text-foreground" data-testid="whatsapp-bulk-count">
                        {recipients.length} member{recipients.length === 1 ? "" : "s"} selected
                    </p>
                    <p className="text-muted-foreground">
                        Message: {types.find((template) => template.id === messageType)?.label ?? "Custom Message"}
                    </p>
                    {messageType !== "custom" && unpaidCount > 0 && <p className="text-orange-600 dark:text-orange-400">
                        {unpaidCount} member{unpaidCount === 1 ? "" : "s"} who never paid will get the "Payment Pending" message instead.
                    </p>}
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Message type</p>
                    <MessageTypePicker types={types} value={messageType} onChange={setMessageType} testIdPrefix="whatsapp-all"/>
                </div>
                {messageType === "custom" && <CustomMessageInput value={customMessage} onChange={setCustomMessage}/>}
                <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Message preview</p>
                    <MessagePreview testId="whatsapp-bulk-preview">
                        {entries.map((entry, index) => (<span key={entry.id} className="block">
                            <span className="font-semibold text-foreground">{entry.name}</span>
                            {"\n"}{entry.message}
                            {index < entries.length - 1 ? "\n\n———\n\n" : ""}
                        </span>))}
                    </MessagePreview>
                    <p className="text-xs text-muted-foreground">{BULK_SEPARATOR_NOTE}</p>
                </div>
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t bg-background p-4 sm:justify-end">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSending} data-testid="button-whatsapp-all-cancel">
                    Cancel
                </Button>
                <Button onClick={handleSend} disabled={!canSend || isSending} className="bg-green-600 hover:bg-green-700 text-white" data-testid="button-whatsapp-send-all">
                    {isSending ? "Opening WhatsApp..." : "Open WhatsApp"}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>);
}
