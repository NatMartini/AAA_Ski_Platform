export type AnalysisJobView = {
  id: string;
  videoId: string | null;
  actionId?: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  createdAt: string;
  finishedAt: string | null;
  result: unknown;
  errorCode: string | null;
  queueReason?: string | null;
  /** FreeSki accepted the job and is waiting for compute; it starts by itself. */
  computeWait?: "compute_offline" | "waiting_for_compute" | null;
};

export type AnalysisVideoView = {
  id: string;
  caption: string | null;
  uploadedAt?: string;
  url: string;
  canDelete: boolean;
  contentType?: string;
  analysisSupported?: boolean;
};

export type AnalysisPurchaseView = {
  id: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  status: "AWAITING_PAYMENT" | "PENDING_PAYMENT_REVIEW" | "PAYMENT_REJECTED" | "CONFIRMED" | "CANCELLED";
  paymentSubmittedAt: string | null;
  reviewNote: string | null;
  updatedAt: string;
};

export type AnalysisActionView = {
  id: string;
  labelZh: string;
  labelEn: string;
  pathType: "improvement" | "certification";
  level: string | null;
  available: boolean;
  groupZh: string;
  groupEn: string;
};

export type VideoAnalysisView = {
  ok: true;
  accountId?: string;
  quota: { active: boolean; freeTotal: number; paidTotal: number; grantTotal?: number; reserved: number; used: number; remaining: number };
  grants?: { id: string; quantity: number; note: string | null; createdAt: string; coach: { name: string | null } }[];
  price: { unitCents: number; currency: "CAD" } | null;
  service: { configured: boolean; available: boolean };
  actions: readonly AnalysisActionView[];
  canAnalyze: boolean;
  canPurchase: boolean;
  canReview: boolean;
  canUpload: boolean;
  videos: AnalysisVideoView[];
  jobs: AnalysisJobView[];
  purchases: AnalysisPurchaseView[];
  payment: { coachName: string; wechatEnabled: boolean; wechatId: string | null; wechatQrUrl: string | null };
};
