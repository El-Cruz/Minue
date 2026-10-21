export type Status = 'pending' | 'delivered' | 'failed';
export type View = 'dashboard' | 'history' | 'destinations' | 'products' | 'deliveries' | 'team' | 'settings';
export type Profile = { id: string; name: string; email: string; is_admin: boolean; is_courier: boolean; active: boolean };
export type Destination = { id: string; name: string; address: string | null; city: string; phone: string; notes: string; active: boolean; receipt_code?: string | null; receipt_next_number?: number };
export type Contact = { id: string; destination_id: string; name: string };
export type Product = { id: string; name: string; unit: string; species: 'dog' | 'cat' | 'both'; active: boolean };
export type DeliveryItem = { product_id: string; name: string; quantity: number; unit: string };
export type Delivery = { id: string; destination_id: string; assigned_to: string | null; partner_id?: string | null; scheduled_date: string; time_window: string; notes: string; status: Status; items: DeliveryItem[]; created_at: string; legacy_source?: string | null; legacy_id?: string | null; legacy_code?: string | null; legacy_courier?: string | null; legacy_profile_ids?: string[] };
export type DeliveryEvent = { id: string; delivery_id: string; actor_id: string; kind: 'failed' | 'rescheduled' | 'created' | 'updated' | 'delivered'; note: string; created_at: string };
export type ReceiptSnapshot = { destination: { name: string; address: string | null; city: string }; items: DeliveryItem[]; courier: string; recipient: string; observation: string; scheduled_date: string; confirmed_at: string; signature_path: string };
export type Receipt = { id: string; delivery_id: string; folio: string; snapshot: ReceiptSnapshot; pdf_path: string | null; created_at: string; receipt_number?: string | null; template_version?: number; drive_status?: 'pending' | 'saved' | 'reconnect'; legacy_id?: string | null; legacy_source?: string | null; legacy_pdf_url?: string | null; legacy_signature_reference?: string | null; signature_data?: string };
export type Data = { profiles: Profile[]; destinations: Destination[]; contacts: Contact[]; products: Product[]; deliveries: Delivery[]; events: DeliveryEvent[]; receipts: Receipt[] };
export type Confirmation = { delivery_id: string; recipient_id: string | null; new_recipient: string; signature: string; observation: string; request_id: string };
export type Command = { action: string; payload: Record<string, unknown> };

export type ReceiptState = { receipt: Receipt; versions: number[]; drive_status: 'pending' | 'saved' | 'reconnect'; originalAvailable: boolean };
