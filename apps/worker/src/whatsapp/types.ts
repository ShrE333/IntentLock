export type WahaMessagePayload = {
  id?: string; timestamp?: number; from?: string; to?: string;
  fromMe?: boolean; body?: string; hasMedia?: boolean;
};

export type WahaWebhook = {
  id?: string; timestamp?: number; event?: string; session?: string;
  payload?: WahaMessagePayload;
};

export type WhatsappChatState = {
  chatId:string;
  activeWalletId:string|null;
  activeSessionId:string|null;
  wahaSession:string;
};
