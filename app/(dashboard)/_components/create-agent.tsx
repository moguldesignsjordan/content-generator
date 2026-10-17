"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { AccentSpinner, Button, LinkButton, Logo, Select, Sheet, useToast } from "@/components/ui";
import {
  CheckIcon,
  CloseIcon,
  ImageIcon,
  PaperclipIcon,
  RefreshIcon,
  SendIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { toastApiError } from "@/lib/billing/toast-error";
import { readSse } from "@/lib/read-sse";
import { useGenerationStream } from "@/lib/use-generation-stream";
import { HomeHero } from "./home-hero";
import { KindTiles } from "./kind-tiles";
import { KIND_ART } from "./art";
import type {
  BlogType,
  ClientBrand,
  EmailType,
  FactoryKind,
  FactoryProduct,
  FunnelStage,
  MediaAsset,
  PieceInputs,
  SeriesDraftRef,
} from "@/lib/db/types";
import { LookPicker } from "./look-picker";
import { CHIP_CLASS, QuestionCard, StepChip } from "./question-card";
import { ProductImport } from "./product-import";
import type { ChatQuestion, QuestionAnswer } from "@/lib/create-questions";
import { AdLibraryPicker } from "./ad-library-picker";
import { ChatPreviewCard, type ChatPreview, type QueuedPreviewAction } from "./chat-preview-card";
import type { PreviewAction } from "@/lib/chat-preview";

// Labels for the manual email_type/blog_type override (migration 005). Left
// unset, generation derives the type from the topic as before; picking one
// here overrides that derivation for this job.
const EMAIL_TYPE_OPTIONS: { value: EmailType; label: string }[] = [
  { value: "newsletter", label: "Newsletter" },
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
  { value: "promotional", label: "Promotional" },
  { value: "announcement", label: "Announcement" },
];

const BLOG_TYPE_OPTIONS: { value: BlogType; label: string }[] = [
  { value: "pillar", label: "Pillar" },
  { value: "how_to", label: "How-to" },
  { value: "listicle", label: "Listicle" },
  { value: "case_study", label: "Case study" },
  { value: "thought_leadership", label: "Thought leadership" },
  { value: "landing", label: "Landing" },
];

interface Msg {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  /** Which of `images` the user labeled Style; the rest are photos. */
  styleImages?: string[];
}

/** An image staged on the composer, uploaded and hosted but not yet sent.
 * Its role is the user's own label: a photo to use in the picture as it
 * is, or a style for the design to follow. */
interface PendingImage {
  url: string;
  name: string;
  role: "picture" | "style";
}

/** The style images the look picker can offer, from the chat's response. */
interface StyleImages {
  urls: string[];
  from: "upload" | "competitor";
}

/* Concrete things you can type, cycled through the empty composer so the
   landing teaches by example instead of a static "type here". */
const PROMPT_IDEAS = [
  "What do you want to make?",
  "A fall sale flyer, 20% off through Nov 30",
  "A win-back email for past clients",
  "A two-week campaign to launch a new service",
  "An Instagram ad for our starter package",
  "A blog post on what a website really costs",
  "Turn our best email into a flyer",
];

/** The landing's kind tiles: tapping one starts the conversation with its
 * text (plus anything already typed). A preset startKind instead shows the
 * describe-it hint and rides at the front of their description on send. */
export type StarterKind = "flyer" | "email" | "campaign" | "blog" | "ad";

const STARTERS: Record<StarterKind, { text: string; hint: string }> = {
  flyer: {
    text: "I want to make a flyer",
    hint: "Tell me about your flyer: what it's for, the offer, dates, where it'll post...",
  },
  email: {
    text: "I want to write an email",
    hint: "Tell me about your email: what it's about, who it's for, any deal...",
  },
  campaign: {
    text: "I want to plan a campaign",
    hint: "Tell me about your campaign: what you're promoting, the offer, how long...",
  },
  blog: {
    text: "I want to write a blog post",
    hint: "Tell me about your post: the topic, who's reading, your take on it...",
  },
  ad: {
    text: "I want to make a paid Facebook or Instagram ad",
    hint: "Tell me about your ad: what you're selling, the offer, who should see it...",
  },
};

/** The chat's inline website product import. */
interface ProductImportOffer {
  brandId: string;
  website: string;
  existing: string[];
}

/** What a send carries besides the text. */
interface SendExtra {
  competitorAdIds?: string[];
  lookChoice?: string;
  /** With lookChoice "ads": the saved ads picked in the look picker. */
  competitorRefIds?: string[];
  answers?: QuestionAnswer[];
  /** A tapped chip's id, e.g. "go" on the confirm. */
  action?: string;
}

/** A campaign the agent handed to the planner, with its settings. */
interface CampaignHandoff {
  summary: string;
  kinds: FactoryKind[];
  size: number;
  days: number;
  research: boolean;
  /** The chat's photos, style, and competitor ads, passed through whole. */
  inputs?: PieceInputs;
  client_brand?: ClientBrand;
  /** One design per product. */
  products?: FactoryProduct[];
  split?: "each";
  per_product?: number;
}

interface CampaignRun {
  handoff: CampaignHandoff;
  campaignId: string;
  phase: string | null;
  error: { message: string; outOfCredits?: boolean } | null;
}

const FACTORY_STEPS = [
  { phase: "researching", label: "Researching trends and competitors" },
  { phase: "planning", label: "Planning the pieces" },
  { phase: "pricing", label: "Pricing the batch" },
];

export interface CreateAgentSuggestion {
  label: string;
  text: string;
}

/** The brief as resolved by the route, rendered as editable rows. */
interface BriefCard {
  topicTitle: string | null;
  subjectLine: string | null;
  preheader: string | null;
  audience: string | null;
  goal: string | null;
  keyMessage: string | null;
  proof: string | null;
  hook: string | null;
  angle: string | null;
  readerBelief: string | null;
  offerName: string | null;
  offerPrice: string | null;
  offerSummary: string | null;
  tone: string | null;
  funnelStage: FunnelStage | null;
  ctaLabel: string | null;
  visualVibe: string | null;
  hasProductPhoto: boolean;
  photoCount: number;
  length: "short" | "standard" | "long" | null;
  includeImage: boolean | null;
}

interface Option {
  id: string;
  label: string;
  kind: "topic" | "action";
}

interface CreateResponse {
  reply?: string;
  campaignId?: string;
  topicId?: string | null;
  card?: BriefCard | null;
  options?: Option[] | null;
  readyToGenerate?: boolean;
  draftId?: string | null;
  series?: SeriesDraftRef[] | null;
  /** Set when the agent hands a campaign to the planner. */
  campaign?: CampaignHandoff | null;
  /** The agent's follow-up questions, shown as one card. */
  questions?: ChatQuestion[] | null;
  /** The agent asked the user to pick a design look. */
  showLookPicker?: boolean;
  /** Their products from their website, to tick and save inline. */
  productImport?: ProductImportOffer | null;
  /** The user shared an Ad Library page: its ads show under the reply. */
  adLibraryUrl?: string | null;
  /** The style the brief follows, as the look picker shows it. */
  style?: { value: string | null; images: StyleImages | null };
  /** The piece shown live in the thread, and a change the agent asked for. */
  preview?: ChatPreview | null;
  previewAction?: PreviewAction | null;
  auto?: boolean;
  error?: string;
}

/** Resumed state from the brand's most recent in-flight campaign, so a page
 * reload picks the thread back up instead of starting blank. */
export interface CreateAgentInitialState {
  campaignId: string;
  messages: Msg[];
  card: BriefCard | null;
  topicId: string | null;
  ready: boolean;
  series: SeriesDraftRef[] | null;
  preview: ChatPreview | null;
  auto: boolean;
}

/**
 * The dashboard creation agent: a brief-then-generate chat that turns "what
 * are we creating today?" into an editable email brief and drives it all the
 * way to a generated draft. Posts to /api/create/chat; when the agent calls
 * generate_content, the piece generates live in the thread (ChatPreviewCard),
 * and later changes the agent asks for run on that card. The brief card + manual
 * Generate button remain as a fallback for turns where the agent asked a
 * clarifying question instead.
 */
export function CreateAgent({
  className,
  initial,
  suggestions = [],
  startKind,
  startText,
  landing,
}: {
  className?: string;
  initial?: CreateAgentInitialState;
  suggestions?: CreateAgentSuggestion[];
  /** Prefills the composer (e.g. a "New campaign" link). */
  startKind?: StarterKind;
  /** Sent once on arrival (an onboarding idea's "Make it"). */
  startText?: string;
  /** Server-rendered rows shown under the kind tiles until the chat starts. */
  landing?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();

  const [messages, setMessages] = useState<Msg[]>(initial?.messages ?? []);
  const [input, setInput] = useState("");
  // The kind chip picked on the landing (e.g. a "New campaign" link presets it).
  const [picked, setPicked] = useState<StarterKind | null>(
    startKind && !initial?.messages.length ? startKind : null,
  );
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const [card, setCard] = useState<BriefCard | null>(initial?.card ?? null);
  const [topicId, setTopicId] = useState<string | null>(initial?.topicId ?? null);
  const [campaignId, setCampaignId] = useState<string | null>(initial?.campaignId ?? null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [questions, setQuestions] = useState<ChatQuestion[] | null>(null);
  const [productImport, setProductImport] = useState<ProductImportOffer | null>(null);
  const [series, setSeries] = useState<SeriesDraftRef[] | null>(initial?.series ?? null);
  const [preview, setPreview] = useState<ChatPreview | null>(initial?.preview ?? null);
  const [queued, setQueued] = useState<QueuedPreviewAction | null>(null);
  const [ready, setReady] = useState(initial?.ready ?? false);
  const [generating, setGenerating] = useState(false);
  // An attached image is uploaded before the user can send, so the paperclip
  // needs its own pending state (send() has its own `loading`).
  const [uploading, setUploading] = useState(false);
  // Images staged on the composer: hosted, thumbnailed, and sent as real
  // image content with the next message so the agent can actually see them
  // (vision) instead of the image being diverted client-side.
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  // The media-library picker: stages already-hosted images from /media onto
  // the composer without re-uploading. Assets are fetched lazily on first
  // open, then cached for the session.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState<MediaAsset[] | null>(null);
  // Guided runs the staged chip interview (default); Auto fills the brief
  // silently from context and stops so the user presses Generate.
  const [mode, setMode] = useState<"guided" | "auto">(initial?.auto ? "auto" : "guided");
  // Which pipeline the brief hands off to. Same brief, different renderer:
  // email → the email draft pipeline, blog → the Sanity-bound blog pipeline.
  const [channel, setChannel] = useState<"email" | "blog">("email");
  // Manual subtype override, sent to /api/generate as-is when set. Left on
  // "" (Auto), generation derives the type from the topic as before.
  const [emailType, setEmailType] = useState<EmailType | "">("");
  const [blogType, setBlogType] = useState<BlogType | "">("");
  // The reply as it streams in, and what the agent is doing right now.
  const [liveText, setLiveText] = useState("");
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  // The agent asked for a design look; the picker shows under its reply.
  const [lookPickerOpen, setLookPickerOpen] = useState(false);
  // The picker's selection: null = Our style, "images" = the style images,
  // "none" = No reference, else a saved look. Sent only when the user taps.
  const [lookId, setLookId] = useState<string | null>(null);
  // What the brief follows on the server, so an unconfirmed tap still counts.
  const [savedLook, setSavedLook] = useState<string | null>(null);
  // A look tapped in the question card's style question.
  const [lookTouched, setLookTouched] = useState(false);
  // Saved competitor ads picked in the look picker, in pick order.
  const [adPicks, setAdPicks] = useState<string[]>([]);
  // The user's style images or ticked ads, offered as their own picker tile.
  const [styleImages, setStyleImages] = useState<StyleImages | null>(null);
  const [adLibraryUrl, setAdLibraryUrl] = useState<string | null>(null);
  // The brief card stays out of the thread unless opened (or Auto mode is
  // waiting on Generate).
  const [briefOpen, setBriefOpen] = useState(false);
  // A campaign the agent handed to the planner: progress, or the error to retry.
  const [campaignRun, setCampaignRun] = useState<CampaignRun | null>(null);

  // Which example prompt the empty composer is showing (landing only).
  const [phIndex, setPhIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Drops a line into the composer without clobbering what's already typed. */
  function appendToInput(text: string) {
    setInput((cur) => (cur.trim() ? cur.trimEnd() + "\n\n" : "") + text);
    inputRef.current?.focus();
  }

  /**
   * Anything else (text, HTML, code, a raw .eml export) is an example of how the
   * email should READ: the text rides into the composer and the agent saves it
   * as style_example. Sent RAW on purpose, no client-side flattening: a Gmail
   * "show original" export is MIME, not HTML, and DOMParser would shred it. The
   * server's emailHtmlToText unwraps MIME and flattens HTML properly, and the
   * 8000-char cap is applied there, after extraction. The generous truncation
   * here only stops a giant paste from choking the textarea.
   */
  function attachTextFile(file: File) {
    file
      .text()
      .then((raw) => {
        const text = raw.trim().slice(0, 100_000);
        if (!text) {
          toast.error("That file looks empty.");
          return;
        }
        appendToInput(
          "Here's an example email I want mine to read like (match its style, not its content):\n\n" +
            text,
        );
      })
      .catch(() => toast.error("Couldn't read that file."));
  }

  /**
   * Real images: hosted as-is (no AI, no design analysis) and staged as
   * thumbnails on the composer. They ride with the NEXT message as real
   * image blocks, so the agent actually sees them (vision) and decides what
   * each is: a product photo, photos for the email, a design to match, etc.
   * One uploading flag covers the whole batch so a multi-photo pick can't be
   * half-sent while the tail is still uploading.
   */
  async function uploadPendingImages(files: File[]) {
    setUploading(true);
    try {
      for (const file of files) {
        try {
          const body = new FormData();
          body.append("file", file);
          const res = await fetch("/api/uploads/image", { method: "POST", body });
          const data = (await res.json()) as { url?: string; error?: string };
          if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't upload that image.");
          setPendingImages((imgs) => [...imgs, { url: data.url!, name: file.name, role: "picture" }]);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't upload that image.");
        }
      }
    } finally {
      setUploading(false);
    }
  }

  /** The paperclip: takes anything a non-technical user might have on hand,
   * several photos at once included. */
  function handleAttachFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    for (const file of files) {
      if (!file.type.startsWith("image/")) attachTextFile(file);
    }
    if (images.length) void uploadPendingImages(images);
  }

  useEffect(() => {
    if (!libraryOpen || libraryAssets !== null) return;
    let cancelled = false;
    fetch("/api/media")
      .then((res) => res.json())
      .then((data: { assets?: MediaAsset[] }) => {
        if (!cancelled) setLibraryAssets(data.assets ?? []);
      })
      .catch(() => {
        if (!cancelled) setLibraryAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryOpen, libraryAssets]);

  /** Tapping a library image toggles it on/off the composer's staged set. */
  function toggleLibraryImage(asset: MediaAsset) {
    setPendingImages((imgs) =>
      imgs.some((i) => i.url === asset.url)
        ? imgs.filter((i) => i.url !== asset.url)
        : [...imgs, { url: asset.url, name: asset.alt ?? "Saved image", role: "picture" }],
    );
  }

  /** Flips a staged image between a photo to use and a style to follow. */
  function toggleImageRole(url: string) {
    setPendingImages((imgs) =>
      imgs.map((i) => (i.url === url ? { ...i, role: i.role === "style" ? "picture" : "style" } : i)),
    );
  }

  const empty = messages.length === 0;

  // Cycle the landing placeholder through concrete prompt ideas. Skipped
  // entirely for reduced-motion users, who keep the first (generic) prompt.
  useEffect(() => {
    if (!empty) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(
      () => setPhIndex((i) => (i + 1) % PROMPT_IDEAS.length),
      3600,
    );
    return () => clearInterval(id);
  }, [empty]);

  useEffect(() => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading, card, options, series, preview, liveText, liveStatus, lookPickerOpen, adLibraryUrl, campaignRun]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  // Sent once, then the ?idea= link is cleared so a reload doesn't resend it.
  const startSent = useRef(false);
  useEffect(() => {
    if (!startText || startSent.current) return;
    startSent.current = true;
    send(startText);
    router.replace("/", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startText]);

  /** extra: the ads ticked in the Ad Library picker (in tick order), a look
   * picker tap, the question card's answers, or a tapped chip's id. */
  function send(text: string, extra: SendExtra = {}) {
    const t = text.trim();
    const imageUrls = pendingImages.map((p) => p.url);
    const styleUrls = pendingImages.filter((p) => p.role === "style").map((p) => p.url);
    if ((!t && imageUrls.length === 0) || loading || generating) return;
    // A look tapped in the open picker counts even when they reply by typing.
    const pickerShown = lookPickerOpen || Boolean(questions?.some((q) => q.id === "style"));
    const lookChoice =
      extra.lookChoice ?? (pickerShown && lookId !== savedLook ? (lookId ?? "our") : undefined);
    const competitorRefIds = lookChoice === "ads" ? (extra.competitorRefIds ?? adPicks) : undefined;
    const displayText =
      t || (imageUrls.length === 1 ? "(attached a photo)" : "(attached photos)");
    setInput("");
    setPendingImages([]);
    setError(null);
    setHint(false);
    setOptions(null);
    setQuestions(null);
    setProductImport(null);
    setLookTouched(false);
    setAdPicks([]);
    setLookPickerOpen(false);
    setAdLibraryUrl(null);
    setMessages((m) => [
      ...m,
      {
        role: "user",
        content: displayText,
        ...(imageUrls.length ? { images: imageUrls } : {}),
        ...(styleUrls.length ? { styleImages: styleUrls } : {}),
      },
    ]);
    void postToAgent(displayText, imageUrls, styleUrls, { ...extra, lookChoice, competitorRefIds });
  }

  function sendFromLanding() {
    if (!picked) return send(input);
    send(`${STARTERS[picked].text}. ${input.trim()}`);
    setPicked(null);
  }

  function pickKind(kind: StarterKind) {
    const typed = input.trim();
    send(typed ? `${STARTERS[kind].text}. ${typed}` : STARTERS[kind].text);
    setPicked(null);
  }

  async function postToAgent(
    text: string,
    imageUrls: string[],
    styleUrls: string[],
    extra: SendExtra,
  ) {
    setLoading(true);
    setLiveText("");
    setLiveStatus(imageUrls.length ? "Looking at your photos" : "Thinking");
    const photoUrls = imageUrls.filter((u) => !styleUrls.includes(u));
    const hintTimer = setTimeout(() => setHint(true), 8000);
    const controller = new AbortController();
    // This route can chain several tool round-trips server-side (up to
    // maxDuration = 300s); abort a good margin before that so a hung request
    // surfaces as an error instead of spinning forever.
    const timeoutTimer = setTimeout(() => controller.abort(), 280_000);

    try {
      const res = await fetch("/api/create/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages,
          campaignId,
          images: photoUrls.length ? photoUrls : undefined,
          ...(styleUrls.length ? { styleImages: styleUrls } : {}),
          auto: mode === "auto",
          ...(extra.lookChoice ? { lookChoice: extra.lookChoice } : {}),
          ...(extra.competitorAdIds?.length ? { competitorAdIds: extra.competitorAdIds } : {}),
          ...(extra.competitorRefIds?.length ? { competitorRefIds: extra.competitorRefIds } : {}),
          ...(extra.answers?.length ? { answers: extra.answers } : {}),
          ...(extra.action ? { action: extra.action } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Something went wrong.");
      }
      // Holders, not lets: TypeScript can't see assignments made in the callback.
      const out: { data?: CreateResponse; failure?: string } = {};
      await readSse(res, (event, payload) => {
        if (event === "delta" && typeof payload.text === "string") {
          const delta = payload.text;
          setLiveStatus(null);
          setLiveText((cur) => cur + delta);
        } else if (event === "reset") {
          setLiveText("");
        } else if (event === "status" && typeof payload.label === "string") {
          setLiveStatus(payload.label);
        } else if (event === "done") {
          out.data = payload as CreateResponse;
        } else if (event === "error") {
          out.failure = String(payload.message ?? "Something went wrong.");
        }
      });
      if (out.failure) throw new Error(out.failure);
      const data = out.data;
      if (!data?.reply) throw new Error("The connection dropped. Try sending that again.");

      setMessages((m) => [...m, { role: "assistant", content: data.reply! }]);
      if (data.campaignId) setCampaignId(data.campaignId);
      setTopicId(data.topicId ?? null);
      setCard(data.card ?? null);
      setOptions(data.options ?? null);
      setQuestions(data.questions?.length ? data.questions : null);
      setProductImport(data.productImport ?? null);
      setLookPickerOpen(Boolean(data.showLookPicker));
      setAdLibraryUrl(data.adLibraryUrl ?? null);
      // The server owns the style: the picker shows what the brief follows.
      if (data.style) {
        setLookId(data.style.value);
        setSavedLook(data.style.value);
        setStyleImages(data.style.images);
      }
      if (data.series?.length) setSeries(data.series);
      setReady(Boolean(data.readyToGenerate));
      if (typeof data.auto === "boolean") setMode(data.auto ? "auto" : "guided");
      if (data.preview) setPreview(data.preview);
      // Replaced every turn, so a new card never replays an old change.
      setQueued(data.previewAction ? { action: data.previewAction, nonce: Date.now() } : null);
      if (data.campaign && data.campaignId) {
        void runFactory(data.campaign, data.campaignId);
      }
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      setError(
        timedOut
          ? "That took too long. Try sending it again."
          : err instanceof Error
            ? err.message
            : "Something went wrong.",
      );
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: timedOut
            ? "Sorry, that took too long. Try sending that again."
            : "Sorry, I hit a snag. Try sending that again.",
        },
      ]);
    } finally {
      clearTimeout(hintTimer);
      clearTimeout(timeoutTimer);
      setLoading(false);
      setLiveText("");
      setLiveStatus(null);
      setHint(false);
      inputRef.current?.focus();
    }
  }

  function clearChat() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    if (campaignId) {
      fetch(`/api/campaigns/${campaignId}/clear`, { method: "POST" }).catch(() => {});
    }
    setMessages([]);
    setInput("");
    setPicked(null);
    setCard(null);
    setTopicId(null);
    setCampaignId(null);
    setOptions(null);
    setQuestions(null);
    setProductImport(null);
    setSeries(null);
    setReady(false);
    setGenerating(false);
    setError(null);
    setPendingImages([]);
    setLookPickerOpen(false);
    setLookId(null);
    setAdPicks([]);
    setSavedLook(null);
    setStyleImages(null);
    setBriefOpen(false);
    setPreview(null);
    setQueued(null);
    setCampaignRun(null);
  }

  /** Runs the planner on a campaign the agent handed off, then opens its plan. */
  async function runFactory(handoff: CampaignHandoff, chatCampaignId: string) {
    setCampaignRun({
      handoff,
      campaignId: chatCampaignId,
      phase: handoff.research ? "researching" : "planning",
      error: null,
    });
    try {
      const res = await fetch("/api/factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence: handoff.summary,
          kinds: handoff.kinds,
          size: handoff.size,
          days: handoff.days,
          research: handoff.research,
          campaign_id: chatCampaignId,
          // The chat's photos, style, and competitor ads, whole.
          ...(handoff.inputs ? { inputs: handoff.inputs } : {}),
          ...(handoff.client_brand ? { client_brand: handoff.client_brand } : {}),
          ...(handoff.products?.length
            ? { products: handoff.products, split: handoff.split, per_product: handoff.per_product }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          outOfCredits?: boolean;
        };
        throw Object.assign(new Error(data.error ?? "Couldn't start the campaign."), {
          outOfCredits: data.outOfCredits,
        });
      }
      const out: { planned?: string; failure?: string } = {};
      await readSse(res, (event, data) => {
        if (event === "phase" && typeof data.phase === "string") {
          const phase = data.phase;
          setCampaignRun((r) => (r ? { ...r, phase } : r));
        } else if (event === "done" && typeof data.campaignId === "string") {
          out.planned = data.campaignId;
        } else if (event === "error") {
          out.failure = String(data.message ?? "Couldn't plan the campaign.");
        }
      });
      if (out.failure) throw new Error(out.failure);
      if (!out.planned) throw new Error("The connection dropped before the plan was ready. Try again.");
      setCampaignRun((r) => (r ? { ...r, phase: "opening" } : r));
      router.push(`/campaigns/${out.planned}`);
    } catch (e) {
      const err = e as Error & { outOfCredits?: boolean };
      setCampaignRun((r) =>
        r ? { ...r, phase: null, error: { message: err.message, outOfCredits: err.outOfCredits } } : r,
      );
    }
  }

  async function generate() {
    if (!topicId || generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId,
          campaignId,
          channel,
          emailType: emailType || undefined,
          blogType: blogType || undefined,
        }),
      });
      const data = (await res.json()) as {
        draftId?: string;
        error?: string;
        outOfCredits?: boolean;
        upgradeUrl?: string;
      };
      if (!res.ok || !data.draftId) {
        toastApiError(toast, data, "Generation failed.");
        setGenerating(false);
        return;
      }
      router.push(`/drafts/${data.draftId}`);
    } catch {
      toast.error("Generation failed.");
      setGenerating(false);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div
        // The thread is a fixed-height chat window. The landing flows at its
        // natural height so the tiles and rows under the composer fit.
        className={cn("flex flex-col", !empty && "overflow-hidden", className)}
        style={empty ? undefined : { height: "clamp(480px, calc(100dvh - 200px), 800px)" }}
      >
        <AnimatePresence mode="wait">
          {empty ? (
            // Landing: headline, composer, kind tiles, ideas, then the rows.
            <motion.div
              key="landing"
              className="flex flex-col items-center gap-8 pb-4 pt-6 sm:pt-10"
              exit={{ opacity: 0, y: -16, filter: "blur(6px)" }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
            >
              <h2 className="max-w-xl text-center font-display text-[32px] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground [text-wrap:balance] sm:text-[48px]">
                {["What", "are", "we"].map((word, i) => (
                  <motion.span key={word} className="mr-[0.24em] inline-block" {...rise(0.15 + i * 0.08)}>
                    {word}
                  </motion.span>
                ))}
                <motion.span className="relative mr-[0.24em] inline-block" {...rise(0.39)}>
                  <span className="text-spectrum-flow">creating</span>
                  <motion.span
                    aria-hidden
                    className="bar-spectrum bar-live absolute -bottom-1 left-0 h-[3px] w-full origin-left rounded-full"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.9, delay: 0.8, ease: EASE_OUT }}
                  />
                </motion.span>
                <motion.span className="inline-block" {...rise(0.47)}>
                  today?
                </motion.span>
              </h2>
              <motion.p
                className="-mt-4 max-w-md text-center text-[15px] leading-relaxed text-muted [text-wrap:balance]"
                {...rise(0.55)}
              >
                Tell me what it&apos;s for, the offer, any dates, and where it&apos;ll go. The more
                you share, the better it turns out.
              </motion.p>
              <div className="w-full max-w-xl">
                <motion.div {...rise(0.6)}>
                  <div className="mb-2 flex justify-end">
                    <ModeToggle mode={mode} onChange={setMode} disabled={loading || generating} />
                  </div>
                  <ComposerBar
                    inputRef={inputRef}
                    input={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendFromLanding();
                      }
                    }}
                    onSend={sendFromLanding}
                    onAttachFiles={handleAttachFiles}
                    onOpenLibrary={() => setLibraryOpen(true)}
                    uploading={uploading}
                    ready={ready}
                    disabled={loading || generating}
                    placeholderCycle={picked ? STARTERS[picked].hint : PROMPT_IDEAS[phIndex]}
                    pendingImages={pendingImages}
                    onRemoveImage={(url) =>
                      setPendingImages((imgs) => imgs.filter((i) => i.url !== url))
                    }
                    onToggleImageRole={toggleImageRole}
                  />
                </motion.div>
              </div>
              <div className="w-full max-w-3xl space-y-8">
                <KindTiles picked={picked} onPick={pickKind} disabled={loading || generating} />
                {suggestions.length > 0 && (
                  <div>
                    <motion.p
                      className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-2"
                      {...rise(1)}
                    >
                      Ideas for you
                    </motion.p>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s, i) => (
                        <motion.button
                          key={s.text}
                          type="button"
                          onClick={() => send(s.text)}
                          disabled={loading || generating}
                          className="max-w-full truncate rounded-full border border-border bg-surface-2/80 px-3.5 py-2 text-left text-[13px] font-medium text-foreground backdrop-blur-md transition-colors hover:border-border-strong hover:bg-surface-3 disabled:opacity-50"
                          {...rise(1.05 + i * 0.07)}
                        >
                          {s.label}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}
                {landing && <motion.div {...rise(1.15)}>{landing}</motion.div>}
              </div>
            </motion.div>
          ) : (
            // Conversation — scrolling thread + docked composer.
            <motion.div
              key="thread"
              className="hero-glow flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-border bg-surface/70 backdrop-blur-xl"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
            >
              <div className="flex items-center justify-between gap-1 border-b border-border bg-surface-2/50 px-3 py-2">
                <ModeToggle mode={mode} onChange={setMode} disabled={loading || generating} />
                {card && (
                  <button
                    type="button"
                    onClick={() => setBriefOpen((v) => !v)}
                    aria-expanded={briefOpen}
                    className="ml-auto mr-1 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    {briefOpen ? "Hide what I have" : "What I have so far"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearChat}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    confirmClear
                      ? "bg-danger/10 text-danger hover:bg-danger/15"
                      : "text-muted hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {confirmClear ? "Confirm clear?" : "Clear chat"}
                </button>
              </div>
              <div
                ref={scrollRef}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 momentum"
              >
                {card && (briefOpen || (ready && mode === "auto")) && (
                  <BriefCardView
                    card={card}
                    disabled={loading || generating}
                    ready={ready && Boolean(topicId)}
                    generating={generating}
                    channel={channel}
                    onChannelChange={setChannel}
                    emailType={emailType}
                    onEmailTypeChange={setEmailType}
                    blogType={blogType}
                    onBlogTypeChange={setBlogType}
                    onApply={(pending) => {
                      const parts: string[] = [];
                      if (pending.Topic) parts.push(`the topic to "${pending.Topic}"`);
                      if (pending.Name) parts.push(`the email's name (subject line) to "${pending.Name}"`);
                      if (pending.Subheader) parts.push(`the subheader to "${pending.Subheader}"`);
                      if (pending.For) parts.push(`the audience to "${pending.For}"`);
                      if (pending.Goal) parts.push(`the goal to "${pending.Goal}"`);
                      if (pending.Message) parts.push(`the key message to "${pending.Message}"`);
                      if (pending.Proof) parts.push(`the proof to "${pending.Proof}"`);
                      if (pending.Hook) parts.push(`the hook to "${pending.Hook}"`);
                      if (pending.Angle) parts.push(`the angle to "${pending.Angle}"`);
                      if (pending.Offer) parts.push(`the offer to "${pending.Offer}"`);
                      if (pending["Reader belief"]) {
                        parts.push(
                          `what readers should believe after reading to "${pending["Reader belief"]}"`,
                        );
                      }
                      if (pending.Tone) parts.push(`the tone to "${pending.Tone}"`);
                      if (pending.Vibe) parts.push(`the vibe to "${pending.Vibe}"`);
                      if (pending.Length) parts.push(`the length to ${pending.Length.toLowerCase()}`);
                      if (pending.Picture) {
                        parts.push(pending.Picture === "Yes" ? "include a picture" : "no picture");
                      }
                      if (!parts.length) return;
                      send(`Update the brief: change ${parts.join(", ")}.`);
                    }}
                    onGenerate={generate}
                  />
                )}

                {series && series.length > 0 && <SeriesCardView items={series} />}

                {messages.map((m, i) => (
                  <Bubble key={i} msg={m} />
                ))}

                {preview && (
                  <div className="sm:pl-9">
                    <ChatPreviewCard key={preview.draftId} preview={preview} queued={queued} />
                  </div>
                )}

                {options && options.length > 0 && !loading && (
                  <div className="flex flex-wrap gap-2 pl-9">
                    {options.map((opt, i) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => send(opt.label, { action: opt.id })}
                        disabled={loading || generating}
                        className={cn("bubble-in", CHIP_CLASS)}
                        style={{ animationDelay: `${i * 45}ms`, animationFillMode: "backwards" }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {questions && !loading && (
                  <QuestionCard
                    key={questions.map((q) => q.id).join()}
                    questions={questions}
                    disabled={loading || generating}
                    lookId={lookId}
                    onLookChange={(v) => {
                      setLookId(v);
                      setLookTouched(true);
                    }}
                    lookTouched={lookTouched}
                    styleImages={styleImages}
                    adPicks={adPicks}
                    onAdPicks={setAdPicks}
                    onSend={(text, answers, lookChoice) =>
                      send(text, { answers, ...(lookChoice ? { lookChoice } : {}) })
                    }
                  />
                )}

                {productImport && !loading && (
                  <div className="bubble-in space-y-3 rounded-[22px] border border-border bg-surface-2 p-3.5 sm:ml-9">
                    <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                      <span className="bar-spectrum h-1 w-4 rounded-full" />
                      Your products
                    </span>
                    <ProductImport
                      brandId={productImport.brandId}
                      website={productImport.website}
                      existing={productImport.existing.map((slug) => ({ slug }))}
                      autoStart
                      onSaved={(saved) => {
                        const names = saved.map((p) => p.name);
                        send(`I added ${names.length === 1 ? "this product" : "these products"}: ${names.join(", ")}.`, {
                          answers: [{ id: "products", values: names }],
                        });
                      }}
                    />
                  </div>
                )}

                {lookPickerOpen && !loading && !questions?.some((q) => q.id === "style") && (
                  <div className="bubble-in space-y-3 rounded-[22px] border border-border bg-surface-2 p-3.5 sm:ml-9">
                    <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                      <span className="bar-spectrum h-1 w-4 rounded-full" />
                      Pick a style
                    </span>
                    <LookPicker
                      value={lookId}
                      onChange={setLookId}
                      styleImages={styleImages}
                      adPicks={adPicks}
                      onAdPicks={setAdPicks}
                    />
                    <StepChip
                      primary
                      label="Use this"
                      onClick={() =>
                        send(
                          lookId === "ads"
                            ? "Follow the ads I picked, in our colors."
                            : lookId === "none"
                              ? "No reference, you pick the style."
                              : lookId === "images"
                                ? styleImages?.from === "competitor"
                                  ? "Follow their ads' look, in our colors."
                                  : "Follow my designs."
                                : lookId
                                  ? "I picked a saved look to follow."
                                  : "Use our style.",
                          { lookChoice: lookId ?? "our" },
                        )
                      }
                    />
                  </div>
                )}

                {adLibraryUrl && !loading && (
                  <div className="bubble-in space-y-3 rounded-[22px] border border-border bg-surface-2 p-3.5 sm:ml-9">
                    <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                      <span className="bar-spectrum h-1 w-4 rounded-full" />
                      Pick ads to learn from
                    </span>
                    <AdLibraryPicker
                      url={adLibraryUrl}
                      onDone={(ids) =>
                        send(
                          ids.length === 1
                            ? "Learn from the ad I picked."
                            : `I saved ${ids.length} ads. Learn from the first one I picked.`,
                          { competitorAdIds: ids },
                        )
                      }
                    />
                  </div>
                )}

                {loading && (
                  <div className="space-y-2">
                    {liveText && <Bubble msg={{ role: "assistant", content: liveText }} live />}
                    {(!liveText || liveStatus) && (
                      <WorkingLine
                        label={liveStatus ?? "Thinking"}
                        hint={hint}
                        showDot={!liveText}
                      />
                    )}
                  </div>
                )}

                {campaignRun && (
                  <div className="sm:pl-9">
                    <CampaignRunView run={campaignRun} onRetry={runFactory} />
                  </div>
                )}
              </div>

              {error && <p className="px-4 pb-1 text-xs text-danger">{error}</p>}

              <div className="p-3 pt-2">
                <ComposerBar
                  inputRef={inputRef}
                  input={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  onSend={() => send(input)}
                  onAttachFiles={handleAttachFiles}
                  onOpenLibrary={() => setLibraryOpen(true)}
                  uploading={uploading}
                  ready={ready}
                  disabled={loading || generating || Boolean(campaignRun)}
                  pendingImages={pendingImages}
                  onRemoveImage={(url) =>
                    setPendingImages((imgs) => imgs.filter((i) => i.url !== url))
                  }
                  onToggleImageRole={toggleImageRole}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Sheet
          open={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          title="Your saved images"
          description="Tap to add photos to your message. They'll be placed in the email."
          size="lg"
        >
          {libraryAssets === null ? (
            <p className="mt-3 text-[12.5px] text-muted">Loading…</p>
          ) : libraryAssets.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-muted">
              Nothing saved yet. Images you upload or generate show up here to
              reuse later, for free.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {libraryAssets.map((asset) => {
                const staged = pendingImages.some((i) => i.url === asset.url);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleLibraryImage(asset)}
                    aria-pressed={staged}
                    className={cn(
                      "relative h-[76px] w-[100px] shrink-0 overflow-hidden rounded-xl border text-left transition-colors",
                      staged ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-accent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.url}
                      alt={asset.alt ?? ""}
                      className="h-full w-full object-cover"
                    />
                    {staged && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                        <CheckIcon size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {pendingImages.length > 0 && (
            <div className="mt-4 flex justify-end">
              <Button variant="gradient" size="sm" onClick={() => setLibraryOpen(false)}>
                Done ({pendingImages.length} added)
              </Button>
            </div>
          )}
        </Sheet>
      </div>
      {/* After the chat box: the page stacks its children with space-y, and
          an absolute backdrop placed first would still push the box down. */}
      <AnimatePresence>
        {empty && (
          <HomeHero
            key="home-hero"
            className="absolute -inset-x-4 -top-4 -z-10 h-[620px] md:-inset-x-8 md:-top-9 md:h-[720px]"
          />
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** One-shot entrance: rises out of a soft blur, starting after `delay`s. */
function rise(delay: number) {
  return {
    initial: { opacity: 0, y: 14, filter: "blur(8px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.7, delay, ease: EASE_OUT },
  };
}

/** Guided runs today's staged chip interview; Auto fills the brief silently
 * from context and stops so the user reviews the card and hits Generate. */
function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: "guided" | "auto";
  onChange: (m: "guided" | "auto") => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5">
      {(["guided", "auto"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          disabled={disabled}
          title={
            m === "auto"
              ? "Fill the brief automatically from your brand, then you hit Generate"
              : "Answer a short chip interview"
          }
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
            mode === m ? "bg-accent text-white" : "text-muted hover:text-foreground",
          )}
        >
          {m === "guided" ? "Guided" : "Auto"}
        </button>
      ))}
    </div>
  );
}

function ComposerBar({
  inputRef,
  input,
  onChange,
  onKeyDown,
  onSend,
  onAttachFiles,
  onOpenLibrary,
  uploading,
  ready,
  disabled,
  placeholderCycle,
  pendingImages,
  onRemoveImage,
  onToggleImageRole,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  /** Attach examples/photos: a text/HTML/eml file drops into the composer as
   * an email to READ like; images (several at once welcome) stage thumbnails
   * and send with the next message so the agent can actually see them
   * (vision). */
  onAttachFiles?: (files: File[]) => void;
  /** Opens the media-library picker to stage saved images without re-uploading. */
  onOpenLibrary?: () => void;
  /** An attached image is still uploading. */
  uploading?: boolean;
  ready: boolean;
  disabled: boolean;
  /** When set (landing), the placeholder cycles through example prompts as a
   * faded-in overlay; the native placeholder is suppressed in its favor. */
  placeholderCycle?: string;
  /** Images uploaded and staged, waiting to ride with the next send. */
  pendingImages?: PendingImage[];
  onRemoveImage?: (url: string) => void;
  /** Flips a staged image between a photo to use and a style to follow. */
  onToggleImageRole?: (url: string) => void;
}) {
  const attachRef = useRef<HTMLInputElement>(null);
  const cycling = placeholderCycle !== undefined && !ready;
  const hasText = Boolean(input.trim()) || Boolean(pendingImages?.length);
  return (
    <div className="hero-ring composer-glow flex flex-col gap-1.5 rounded-[28px] border border-border bg-surface-2 p-2 pl-2.5">
      {pendingImages && pendingImages.length > 0 && (
        <div className="flex flex-wrap gap-2 px-0.5 pt-0.5">
          {pendingImages.map((img) => (
            <div key={img.url} className="flex w-16 shrink-0 flex-col items-center gap-1">
              <div
                className={cn(
                  "group relative h-12 w-12 overflow-hidden rounded-[var(--radius-md)] border",
                  img.role === "style" ? "border-accent" : "border-border",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
                {onRemoveImage && (
                  <button
                    type="button"
                    onClick={() => onRemoveImage(img.url)}
                    aria-label={`Remove ${img.name}`}
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <CloseIcon size={10} />
                  </button>
                )}
              </div>
              {onToggleImageRole && (
                <button
                  type="button"
                  onClick={() => onToggleImageRole(img.url)}
                  aria-label={
                    img.role === "style"
                      ? `${img.name}: a style to follow. Tap to use it in the picture instead.`
                      : `${img.name}: used in the picture as it is. Tap to follow it as a style instead.`
                  }
                  title={
                    img.role === "style"
                      ? "A design to follow. Tap to use it in the picture instead."
                      : "Shown in the picture as it is. Tap to follow it as a style instead."
                  }
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none transition-colors",
                    img.role === "style"
                      ? "border-accent/50 bg-accent/[0.12] text-foreground"
                      : "border-border text-muted hover:text-foreground",
                  )}
                >
                  {img.role === "style" ? "Style" : "In picture"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5">
      {onAttachFiles && (
        <>
          <button
            type="button"
            onClick={() => attachRef.current?.click()}
            disabled={uploading}
            aria-label="Attach photos or an example email"
            title="Attach photos or an example email"
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-foreground disabled:opacity-50"
          >
            {uploading ? <AccentSpinner size={14} /> : <PaperclipIcon size={18} />}
          </button>
          <input
            ref={attachRef}
            type="file"
            multiple
            // image/* first and unrestricted: a phone screenshot can be HEIC,
            // and naming only png/jpeg/webp made the picker grey out real
            // photos. Text-ish files stage as "write like this"; images stage
            // as thumbnails and send with the next message (vision).
            accept="image/*,.txt,.md,.html,.htm,.eml,text/plain,text/html,message/rfc822"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onAttachFiles(files);
              e.target.value = "";
            }}
          />
        </>
      )}
      {onOpenLibrary && (
        <button
          type="button"
          onClick={onOpenLibrary}
          aria-label="Add a photo from your saved images"
          title="Add a photo from your saved images"
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          <ImageIcon size={18} />
        </button>
      )}
      <div className="relative min-w-0 flex-1 self-center">
        <textarea
          ref={inputRef}
          value={input}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          aria-label="Message the create agent"
          placeholder={
            cycling
              ? undefined
              : ready
                ? "Tweak the brief, or hit Generate"
                : "Message"
          }
          className="max-h-32 min-h-[40px] w-full resize-none bg-transparent py-2 text-[15px] leading-relaxed text-foreground placeholder:text-muted focus:outline-none"
        />
        {cycling && !input && (
          <span
            key={placeholderCycle}
            aria-hidden
            className="ph-cycle pointer-events-none absolute inset-x-0 top-2 truncate text-[15px] leading-relaxed text-muted"
          >
            {placeholderCycle}
          </span>
        )}
      </div>
      <Button
        variant="gradient"
        size="md"
        className={cn(
          "h-10 w-10 shrink-0 self-center !px-0",
          hasText && "send-pop",
        )}
        onClick={onSend}
        disabled={disabled || !hasText}
        aria-label="Send message"
      >
        <SendIcon size={18} />
      </Button>
      </div>
    </div>
  );
}

/** The planner's progress after the agent hands off a campaign, or its error. */
function CampaignRunView({
  run,
  onRetry,
}: {
  run: CampaignRun;
  onRetry: (handoff: CampaignHandoff, campaignId: string) => void;
}) {
  const steps = run.handoff.research
    ? FACTORY_STEPS
    : FACTORY_STEPS.filter((s) => s.phase !== "researching");
  const active = run.phase === "opening" ? steps.length : steps.findIndex((s) => s.phase === run.phase);
  return (
    <div className="bubble-in overflow-hidden rounded-[22px] border border-border bg-surface-2">
      <div className="flex items-center gap-3 px-3.5 pb-3 pt-3.5">
        <span className="art-frame h-10 w-10 shrink-0 overflow-hidden rounded-[12px]">
          <Image src={KIND_ART.campaign} alt="" sizes="40px" className="h-full w-full scale-[1.2] object-cover" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Campaign</p>
          <p className="truncate text-[14px] font-semibold leading-snug text-foreground">{run.handoff.summary}</p>
        </div>
      </div>

      {run.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3.5 py-3" role="alert">
          <p className="min-w-0 flex-1 text-[13px] text-danger">{run.error.message}</p>
          {run.error.outOfCredits ? (
            <LinkButton href="/billing" size="sm" variant="gradient">
              Top up credits
            </LinkButton>
          ) : (
            <Button size="sm" variant="outline" onClick={() => onRetry(run.handoff, run.campaignId)}>
              <RefreshIcon size={15} />
              Try again
            </Button>
          )}
        </div>
      ) : (
        <>
          <ol className="space-y-2.5 px-3.5 pb-3" aria-live="polite">
            {steps.map((s, i) => (
              <li key={s.phase} className="flex items-center gap-3 text-[14px]">
                {i < active ? (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                    <CheckIcon size={13} />
                  </span>
                ) : i === active ? (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                    <AccentSpinner size={18} />
                  </span>
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold tabular-nums text-muted-2">
                    {i + 1}
                  </span>
                )}
                <span className={i === active ? "text-shimmer font-medium" : i < active ? "text-foreground" : "text-muted"}>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
          <p className="border-t border-border px-3.5 py-2.5 text-[12px] text-muted-2">
            {run.phase === "opening" ? "Opening your plan..." : "This takes a minute or two. The plan opens when it's ready."}
          </p>
          <div className="h-[3px] overflow-hidden bg-surface-3">
            <div
              className="bg-spectrum h-full w-1/3 rounded-full"
              style={{ animation: "progress-indeterminate 1.3s ease-in-out infinite" }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* The agent's identity dot: the Mogul mark inside a static spectrum ring.
   Marks assistant turns (and the thinking state) without a heavy avatar. */
function AgentDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ring-spectrum flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2",
        className,
      )}
    >
      <Logo height={15} alt="" className="!rounded-none" />
    </span>
  );
}

/** `live`: the reply is still streaming in, so it ends in a blinking caret. */
function Bubble({ msg, live }: { msg: Msg; live?: boolean }) {
  const isUser = msg.role === "user";
  if (isUser) {
    return (
      <div className="bubble-in flex justify-end">
        <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-[0_8px_24px_-14px_rgba(255,61,140,0.7)] sm:max-w-[75%]">
          {msg.images && msg.images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {msg.images.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="h-20 w-20 rounded-[var(--radius-md)] object-cover ring-1 ring-white/25"
                />
              ))}
            </div>
          )}
          <span className="whitespace-pre-wrap">{msg.content}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="bubble-in flex items-end gap-2">
      <AgentDot className="mb-0.5" />
      <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-bl-md border border-border bg-surface-2 px-4 py-2.5 text-[14.5px] leading-relaxed text-foreground sm:max-w-[75%]">
        {msg.content}
        {live && (
          <span aria-hidden className="caret-blink ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] bg-foreground" />
        )}
      </div>
    </div>
  );
}

interface BriefRow {
  label: string;
  value: string | null;
  hint?: string;
}

/**
 * The editable brief card. Every row is tap-to-edit, but edits are held
 * locally until "Apply changes" is pressed — so you can fill out the whole
 * card and send it through the agent in a single round-trip instead of one
 * field at a time. When ready, a Generate action hands off to the draft
 * pipeline.
 */
function BriefCardView({
  card,
  disabled,
  ready,
  generating,
  channel,
  onChannelChange,
  emailType,
  onEmailTypeChange,
  blogType,
  onBlogTypeChange,
  onApply,
  onGenerate,
}: {
  card: BriefCard;
  disabled: boolean;
  ready: boolean;
  generating: boolean;
  channel: "email" | "blog";
  onChannelChange: (c: "email" | "blog") => void;
  emailType: EmailType | "";
  onEmailTypeChange: (t: EmailType | "") => void;
  blogType: BlogType | "";
  onBlogTypeChange: (t: BlogType | "") => void;
  onApply: (pending: Partial<Record<string, string>>) => void;
  onGenerate: () => void;
}) {
  // Uncommitted row edits, keyed by row label. Held locally until Apply sends
  // them through the agent in one batch, then cleared.
  const [drafts, setDrafts] = useState<Partial<Record<string, string>>>({});

  const rows: BriefRow[] = [
    { label: "Topic", value: card.topicTitle },
    {
      label: "Name",
      value: card.subjectLine,
      hint: card.subjectLine ? undefined : "the subject line readers see",
    },
    {
      label: "Subheader",
      value: card.preheader,
      hint: card.preheader ? undefined : "the preview line under the subject",
    },
    { label: "For", value: card.audience },
    {
      label: "Goal",
      value: card.goal,
      hint: card.funnelStage
        ? `${card.funnelStage}${card.ctaLabel ? ` · ${card.ctaLabel}` : ""}`
        : undefined,
    },
    { label: "Message", value: card.keyMessage },
    {
      label: "Proof",
      value: card.proof,
      hint: card.proof ? undefined : "e.g. a stat, before/after, or client win",
    },
    {
      label: "Offer",
      value: card.offerName,
      hint: [card.offerSummary, card.offerPrice, card.hasProductPhoto ? "photo attached" : null]
        .filter(Boolean)
        .join(" · ") || undefined,
    },
    {
      label: "Tone",
      value: card.tone,
      hint: card.tone ? undefined : "brand voice",
    },
  ];

  const moreRows: BriefRow[] = [
    {
      label: "Hook",
      value: card.hook,
      hint: card.hook ? undefined : "how it should open",
    },
    {
      label: "Angle",
      value: card.angle,
      hint: card.angle ? undefined : "the unique spin, if any",
    },
    {
      label: "Reader belief",
      value: card.readerBelief,
      hint: card.readerBelief ? undefined : "how they should feel after",
    },
    {
      label: "Vibe",
      value: card.visualVibe,
      hint: card.visualVibe ? undefined : "visual style, e.g. punchy, sleek",
    },
  ];
  const moreSetCount = moreRows.filter((r) => r.value).length;
  const [showMore, setShowMore] = useState(false);

  const pendingCount = Object.values(drafts).filter((v) => v !== undefined).length;

  const lengthValue =
    drafts.Length ??
    (card.length ? card.length.charAt(0).toUpperCase() + card.length.slice(1) : null);
  const pictureValue =
    drafts.Picture ?? (card.includeImage === null ? null : card.includeImage ? "Yes" : "No");

  function renderRow(row: BriefRow) {
    return (
      <EditableRow
        key={row.label}
        label={row.label}
        value={drafts[row.label] ?? row.value}
        hint={row.hint}
        disabled={disabled}
        onCommit={(value) => setDrafts((d) => ({ ...d, [row.label]: value }))}
      />
    );
  }

  return (
    <div
      className={cn(
        "bubble-in rounded-[22px] border bg-surface-2 p-3.5 transition-shadow duration-300",
        // Ready is the payoff moment: the brief wears the spectrum hairline
        // and a soft halo, signaling "this is what gets generated".
        ready ? "ring-spectrum glow-spectrum-soft border-transparent" : "border-border",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          <span className="bar-spectrum h-1 w-4 rounded-full" />
          Brief
        </span>
        {ready && !generating && (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Ready
          </span>
        )}
      </div>

      <div className="divide-y divide-border">
        {rows.map(renderRow)}
        <ChoiceRow
          label="Length"
          options={["Short", "Standard", "Long"]}
          value={lengthValue}
          disabled={disabled}
          onPick={(v) => setDrafts((d) => ({ ...d, Length: v }))}
        />
        <ChoiceRow
          label="Picture"
          options={["Yes", "No"]}
          value={pictureValue}
          disabled={disabled}
          onPick={(v) => setDrafts((d) => ({ ...d, Picture: v }))}
        />
        {showMore && moreRows.map(renderRow)}
      </div>

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        aria-expanded={showMore}
        className="mt-1 px-1 py-1 text-[12px] font-medium text-muted transition-colors hover:text-foreground"
      >
        {showMore
          ? "Fewer details"
          : `More details${moreSetCount ? ` (${moreSetCount} set)` : ""}`}
      </button>

      {card.photoCount > 0 && (
        <p className="mt-2 px-1 text-[12px] text-muted">
          {card.photoCount} photo{card.photoCount === 1 ? "" : "s"} attached, shown as
          they are{card.photoCount > 1 ? ", the first one leads" : ""}
        </p>
      )}

      {/* Batch apply: send every pending row edit through the agent at once
          instead of one field per round-trip. Hidden until something changes. */}
      {pendingCount > 0 && (
        <div className="flex items-center justify-between gap-3 px-1 pt-3">
          <span className="text-[11.5px] text-muted-2">
            {pendingCount} change{pendingCount === 1 ? "" : "s"} ready
          </span>
          <Button
            size="sm"
            variant="gradient"
            onClick={() => {
              onApply(drafts);
              setDrafts({});
            }}
            disabled={disabled}
          >
            Apply changes
          </Button>
        </div>
      )}

      {card.keyMessage && (
        <p className="mt-2 rounded-[var(--radius-md)] bg-surface-3 px-3 py-2 text-[13px] italic text-muted">
          &ldquo;{card.keyMessage}&rdquo;
        </p>
      )}

      {ready && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5">
              {(["email", "blog"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChannelChange(c)}
                  disabled={disabled}
                  className={cn(
                    "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                    channel === c
                      ? "bg-accent text-white"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {c === "email" ? "Email" : "Blog post"}
                </button>
              ))}
            </div>
            <div className="w-[150px] shrink-0">
              {channel === "email" ? (
                <Select
                  value={emailType}
                  onChange={(e) => onEmailTypeChange(e.target.value as EmailType | "")}
                  disabled={disabled}
                  className="h-8 !px-2.5 text-[12px]"
                  aria-label="Email type override"
                >
                  <option value="">Auto type</option>
                  {EMAIL_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select
                  value={blogType}
                  onChange={(e) => onBlogTypeChange(e.target.value as BlogType | "")}
                  disabled={disabled}
                  className="h-8 !px-2.5 text-[12px]"
                  aria-label="Blog type override"
                >
                  <option value="">Auto format</option>
                  {BLOG_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>
          <Button
            variant="gradient"
            size="sm"
            onClick={onGenerate}
            loading={generating}
            disabled={disabled}
          >
            {generating
              ? "Generating…"
              : channel === "blog"
                ? "Generate blog post"
                : "Generate email"}
          </Button>
        </div>
      )}

      {/* Honest progress: a spectrum sweep while the draft is being written. */}
      {generating && (
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-surface-3">
          <div
            className="bg-spectrum h-full w-1/3 rounded-full"
            style={{ animation: "progress-indeterminate 1.3s ease-in-out infinite" }}
          />
        </div>
      )}
    </div>
  );
}


/** How many series emails generate at once; keeps a 10-email series from
 * firing 10 concurrent Claude calls at once. */
const SERIES_CONCURRENCY = 3;

/**
 * The deliverable card for a multi-email campaign: one row per created draft.
 * All emails start writing themselves as soon as the card appears (a few at a
 * time, via the same SSE stream the draft review page uses), so the whole
 * series is ready to review without opening each draft first.
 */
function SeriesCardView({ items }: { items: SeriesDraftRef[] }) {
  const ids = items.map((item) => item.draft_id);
  const [settled, setSettled] = useState<Record<string, "ready" | "error">>({});

  // The first SERIES_CONCURRENCY not-yet-settled drafts are "active" (mounted,
  // streaming); the rest wait their turn. A settled slot frees up immediately
  // since it drops out of this filter on the next render.
  const active = new Set<string>();
  for (const id of ids) {
    if (active.size >= SERIES_CONCURRENCY) break;
    if (!settled[id]) active.add(id);
  }

  return (
    <div className="bubble-in rounded-[22px] border border-border bg-surface-2 p-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          <span className="bar-spectrum h-1 w-4 rounded-full" />
          Campaign series
        </span>
        <span className="text-[11px] font-medium text-muted">
          {items.length} emails
        </span>
      </div>
      <div className="divide-y divide-border">
        {items.map((item, i) => (
          <SeriesRow
            key={item.draft_id}
            index={i}
            item={item}
            active={active.has(item.draft_id)}
            settledStatus={settled[item.draft_id]}
            onSettle={(status) =>
              setSettled((s) => ({ ...s, [item.draft_id]: status }))
            }
          />
        ))}
      </div>
      <p className="mt-2 px-1 text-[12px] text-muted-2">
        All emails are writing themselves now. Open any one to review, approve,
        and schedule it.
      </p>
    </div>
  );
}

function SeriesRow({
  index,
  item,
  active,
  settledStatus,
  onSettle,
}: {
  index: number;
  item: SeriesDraftRef;
  active: boolean;
  settledStatus: "ready" | "error" | undefined;
  onSettle: (status: "ready" | "error") => void;
}) {
  const typeChip = item.email_type && (
    <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] capitalize text-muted">
      {item.email_type}
    </span>
  );

  if (!active && !settledStatus) {
    // Not this row's turn yet: static, no connection opened.
    return (
      <div className="flex items-center gap-3 px-1 py-2.5 text-[13.5px] opacity-70">
        <span className="w-5 shrink-0 text-right tabular-nums text-muted-2">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
        {typeChip}
        <span className="shrink-0 text-[11.5px] text-muted-2">Queued</span>
      </div>
    );
  }

  return (
    <SeriesRowStreaming
      index={index}
      item={item}
      settledStatus={settledStatus}
      onSettle={onSettle}
      typeChip={typeChip}
    />
  );
}

/** Split out so useGenerationStream only mounts (and opens a connection) once
 * a row goes active, and unmounts are cheap once it settles. */
function SeriesRowStreaming({
  index,
  item,
  settledStatus,
  onSettle,
  typeChip,
}: {
  index: number;
  item: SeriesDraftRef;
  settledStatus: "ready" | "error" | undefined;
  onSettle: (status: "ready" | "error") => void;
  typeChip: ReactNode;
}) {
  const stream = useGenerationStream(item.draft_id);
  const notified = useRef(false);

  useEffect(() => {
    if (notified.current) return;
    if (stream.status === "ready" || stream.status === "error") {
      notified.current = true;
      onSettle(stream.status);
    }
  }, [stream.status, onSettle]);

  const status = settledStatus ?? stream.status;
  const isReady = status === "ready";
  const isError = status === "error";

  if (isReady || isError) {
    return (
      <Link
        href={`/drafts/${item.draft_id}`}
        className="group flex items-center gap-3 px-1 py-2.5 text-[13.5px]"
      >
        <span className="w-5 shrink-0 text-right tabular-nums text-muted-2">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-accent">
          {item.title}
        </span>
        {typeChip}
        {isError ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              notified.current = false;
              stream.retry();
            }}
            className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-[11.5px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
          >
            Retry
          </button>
        ) : (
          <span className="shrink-0 text-[12px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
            Open
          </span>
        )}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 px-1 py-2.5 text-[13.5px]">
      <span className="w-5 shrink-0 text-right tabular-nums text-muted-2">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
      {typeChip}
      <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted-2">
        <AccentSpinner size={12} />
        {stream.label}
      </span>
    </div>
  );
}

/** A brief row with a fixed set of answers, tapped instead of typed. Nothing
 * picked means the brand default applies. */
function ChoiceRow({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: string[];
  value: string | null;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-1 py-2 text-[13.5px]">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onPick(opt)}
            aria-pressed={value === opt}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[12.5px] font-medium transition-colors disabled:opacity-60",
              value === opt
                ? "border-accent bg-accent text-white"
                : "border-border bg-surface text-muted hover:text-foreground",
            )}
          >
            {opt}
          </button>
        ))}
        {!value && <span className="text-[12px] text-muted-2">brand default</span>}
      </div>
    </div>
  );
}

function EditableRow({
  label,
  value,
  hint,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | null;
  hint?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== (value ?? "")) onCommit(next);
  }

  return (
    <div className="flex items-center gap-3 px-1 py-2 text-[13.5px]">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEditing(true)}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left disabled:opacity-60"
        >
          <span
            className={cn(
              "truncate",
              value ? "text-foreground" : "text-muted-2 italic",
            )}
          >
            {value || `add ${label.toLowerCase()}`}
          </span>
          {hint && <span className="shrink-0 text-[12px] text-muted-2">{hint}</span>}
        </button>
      )}
    </div>
  );
}

/* Thinking state in brand color: the three spectral dots pulse in sequence,
   amber into magenta into cyan. Reduced motion collapses to steady dots. */
/** What the agent is doing right now: pulsing spectrum dots and a shimmering
 * label ("Thinking", "Setting up your flyer"), so a long step never looks
 * frozen. */
function WorkingLine({
  label,
  hint,
  showDot,
}: {
  label: string;
  hint: boolean;
  showDot: boolean;
}) {
  return (
    <div className="bubble-in flex items-end gap-2" role="status" aria-live="polite">
      {showDot ? <AgentDot className="mb-0.5" /> : <span className="w-7 shrink-0" />}
      <div className="flex items-center gap-2.5 rounded-[20px] rounded-bl-md border border-border bg-surface-2 px-4 py-3">
        <span className="inline-flex gap-1">
          {(["bg-amber", "bg-magenta", "bg-cyan"] as const).map((tone, i) => (
            <span
              key={tone}
              className={cn("dot-spectrum h-1.5 w-1.5 rounded-full", tone)}
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </span>
        <span className="text-shimmer text-[13px] font-medium">{label}</span>
        {hint && <span className="text-[11px] text-muted-2">this can take a minute</span>}
      </div>
    </div>
  );
}
