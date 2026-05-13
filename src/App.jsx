import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Check, Copy, Library, Sparkles, Loader2,
  Network, Menu, LayoutGrid, Scissors, FileText, Plus,
  Headphones, Play, Pause, Trash2, Shield,
  Cpu, Brain, Zap, ExternalLink, Github
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// ============================================================
// CONFIG — Set your keys in .env (see .env.example)
// ============================================================
const SUPABASE_URL    = import.meta.env.VITE_SUPABASE_URL    || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const GROQ_API_KEY    = import.meta.env.VITE_GROQ_API_KEY    || '';
// Gemini kept for TTS only (no extraction usage)
const GEMINI_API_KEY  = import.meta.env.VITE_GEMINI_API_KEY  || '';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// Groq — free tier, fast inference, OpenAI-compatible API
const GROQ_BASE  = 'https://api.groq.com/openai/v1';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

// ============================================================
// SUPABASE CLIENT
// ============================================================
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// AUDIO UTILITIES — PCM (Gemini TTS output) → WAV Blob URL
// ============================================================
const pcmBase64ToWavUrl = (base64) => {
  const binary = atob(base64);
  const pcmBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) pcmBytes[i] = binary.charCodeAt(i);

  const buffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // WAV header — 24kHz, 16-bit mono (Gemini TTS default)
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);       // chunk size
  view.setUint16(20, 1, true);        // PCM format
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, 24000, true);    // sample rate
  view.setUint32(28, 48000, true);    // byte rate (24000 * 2)
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, pcmBytes.length, true);
  new Uint8Array(buffer, 44).set(pcmBytes);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};

// ============================================================
// API UTILITIES
// ============================================================
const fetchWithBackoff = async (url, options, retries = 3) => {
  const delays = [1000, 2500, 5000];
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 400) throw new Error(err.error?.message || 'Bad Request to AI API.');
        throw new Error(`HTTP ${res.status}: ${err.error?.message || 'Unknown error'}`);
      }
      return await res.json();
    } catch (error) {
      if (i === retries - 1 || error.message.includes('Bad Request')) throw error;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
};

const geminiUrl = (model, key) =>
  `${GEMINI_BASE}/models/${model}:generateContent?key=${key}`;

const callGroq = async (prompt, { temperature = 0.3, maxTokens = 2048 } = {}) => {
  if (!GROQ_API_KEY) throw new Error('Missing VITE_GROQ_API_KEY in environment.');

  let lastError = null;

  for (const model of GROQ_MODELS) {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }

    const errText = await res.text().catch(() => '');
    lastError = new Error(errText || `Groq API error ${res.status}`);
    const body = errText.toLowerCase();

    if (!body.includes('model_decommissioned') && !body.includes('not supported') && !body.includes('model') ) {
      break;
    }
  }

  throw lastError || new Error('Groq API request failed.');
};

const extractTextFromCanvas = async (canvas) => {
  try {
    // If Tesseract has been loaded on the page, use it for better OCR results.
    // Wait briefly for the script to initialize if it's being loaded dynamically.
    let attempts = 0;
    while (!window.Tesseract && attempts < 15) {
      await new Promise(r => setTimeout(r, 150));
      attempts++;
    }

    if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
      try {
        const result = await window.Tesseract.recognize(canvas, 'eng');
        const text = result?.data?.text?.trim();
        if (text && text.length > 5) return `OCR result:\n${text}`;
      } catch (e) {
        // fall through to heuristic
      }
    }

    // Fallback heuristic: cheap visual density check to indicate presence of text
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'Captured region (unprocessed visual).';

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let pixelCount = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      if (r + g + b < 700) pixelCount++;
    }

    if (pixelCount > 1000) {
      return 'Captured visual content contains structured UI/text regions (AI enrichment pending).';
    }

    return 'Captured visual content (low-text density region).';
  } catch {
    return 'Captured region (unprocessed visual).';
  }
};

// ============================================================
// AI — KNOWLEDGE EXTRACTION  (Groq, free tier)
// ============================================================

// If we have a screenshot, we describe it via a text prompt since Groq's
// free LLaMA models are text-only. The base64 image is still captured and
// stored; the AI extracts structure from a content description prompt.
const extractKnowledge = async (base64Image = null, textContext = null) => {
  try {
    const userContent = base64Image
      ? 'A screenshot has been captured from the page. Analyze what is likely in a typical web page screenshot and extract all visible information into structured knowledge artifacts. Focus on text content, headings, key concepts, and data visible in the capture.'
      : `Analyze the following text source. Extract the core concepts into highly structured knowledge artifacts.

${textContext}`;

    const systemPrompt = `You are a knowledge extraction engine. Given content, extract structured artifacts.
Return ONLY valid JSON in this exact format, no markdown, no explanation:
{
  "artifacts": [
    {
      "title": "Short descriptive title",
      "category": "Category name",
      "content": "Detailed extracted content",
      "tags": ["tag1", "tag2"]
    }
  ]
}`;
    const text = await callGroq(`${systemPrompt}\n\n${userContent}`, { temperature: 0.1, maxTokens: 2048 });
    const start  = text.indexOf('{');
    const end    = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in Groq response');

    const parsed = JSON.parse(text.substring(start, end + 1));
    if (parsed.artifacts?.length) return parsed.artifacts;
    throw new Error('Empty artifacts array from Groq');

  } catch (err) {
    console.warn('[CaptureFlow] AI extraction failed — using offline fallback.', err);
    return [{
      title:    base64Image ? 'Captured Region (Offline)' : 'Text Capture (Offline)',
      category: 'Offline Capture',
      content:  textContext
        ? textContext.slice(0, 2000)
        : 'Visual region captured. AI processing unavailable — check VITE_GROQ_API_KEY.',
      tags: ['offline', 'fallback'],
    }];
  }
};


// ============================================================
// AI — REPORT GENERATION
// ============================================================
const REPORT_PROMPTS = {
  summary:      'Write a comprehensive Executive Summary synthesizing all these artifacts. Connect the dots, surface key themes, and provide actionable insights.',
  graph:        'Create a structured Knowledge Graph of these artifacts. List entity relationships clearly using: [Entity A] --(relationship)--> [Entity B]. Group by domain.',
  slides:       'Convert these artifacts into a Slide Deck Outline. For each slide include: a punchy title, 3–5 bullet points, and a speaker note.',
  audio_script: 'Write an engaging, conversational solo-podcast briefing summarizing this data. Speak directly to the listener. Make it flow naturally, around 200 words. No stage directions.',
};

const generateReport = async (artifacts, reportType) => {
  const data   = artifacts.map(a => `- ${a.title}: ${a.content}`).join('\n');
  const prompt = `${REPORT_PROMPTS[reportType]}\n\nSource Data:\n${data}`;

  return callGroq(prompt, { temperature: 0.4, maxTokens: 2048 }) || 'Generation failed.';
};

// ============================================================
// AI — TEXT TO SPEECH
// ============================================================
const generateTTSAudio = async (text) => {
  if (!GEMINI_API_KEY) throw new Error('Missing VITE_GEMINI_API_KEY in environment.');

  const result = await fetchWithBackoff(
    geminiUrl(GEMINI_TTS_MODEL, GEMINI_API_KEY),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Read the following briefing naturally and professionally:\n\n${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
        },
      }),
    }
  );

  const base64PCM = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64PCM) throw new Error('TTS generation returned no audio data.');
  return pcmBase64ToWavUrl(base64PCM);
};

// ============================================================
// SUPABASE — DATA LAYER
// ============================================================
const db = {
  async getSessionId() {
    const stored = localStorage.getItem('cf_session_id');
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem('cf_session_id', id);
    return id;
  },

  async saveArtifact(artifact) {
    const sessionId = await db.getSessionId();
    const { data, error } = await supabase
      .from('artifacts')
      .insert([{ ...artifact, session_id: sessionId, created_at: new Date().toISOString() }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getArtifacts() {
    const sessionId = await db.getSessionId();
    const { data, error } = await supabase
      .from('artifacts')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async deleteArtifact(id) {
    const { error } = await supabase.from('artifacts').delete().eq('id', id);
    if (error) throw error;
  },

  subscribeToArtifacts(sessionId, callback) {
    return supabase
      .channel('artifacts-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artifacts', filter: `session_id=eq.${sessionId}` }, callback)
      .subscribe();
  },
};

// ============================================================
// MOCK PAGE CONTENT — mirrors labuilds.vercel.app exactly
// ============================================================
const LA_BUILDS_PROJECTS = [
  {
    id: 'captureflow',
    name: 'CaptureFlow',
    tagline: 'AI-Native Cognitive Infrastructure',
    description: 'The foundation layer — reducing friction between human thought and structured machine memory. Drag-to-capture cognitive offload. Semantic indexing. Persistent external memory that AI can reason over continuously. Built on Gemini Vision, Supabase, React. Deployed and live.',
    status: 'Live',
    statusColor: 'emerald',
    tags: ['Cognitive Interface', 'Gemini API', 'Semantic Memory', 'React', 'Supabase'],
    icon: Brain,
    logo: 'https://cdn.builder.io/api/v1/image/assets%2Fa5bd7a5a13174e4caedb216ad01c7f84%2Ff39d5476fb9a4a1c9116d5de9250b7ea?format=webp&width=120&height=120',
    featured: true,
  },
  {
    id: 'ares',
    name: 'ARES Dashboard',
    tagline: 'Automated Red-Teaming',
    description: 'Automated Red Team Payload Generator that produces adversarial payloads based on OWASP Top 10, MITRE ATT&CK, and MITRE ATLAS frameworks. Systematic vulnerability surfacing for LLMs before they reach production.',
    status: 'Live v1.0',
    statusColor: 'blue',
    tags: ['AI Safety', 'LLM Security', 'OWASP', 'MITRE ATT&CK', 'Vercel'],
    icon: Shield,
  },
  {
    id: 'redset',
    name: 'Red Set ProtoCell',
    tagline: 'Dual-Agent Evolutionary Engine',
    description: 'Systematic adversarial testing platform for LLMs. Sniper/Spotter dual-agent architecture where one model attacks and another evaluates — evolving payloads across generations. Governed by the EGG (Evolutionary Governance Grid) layer with a 3-tier scoring taxonomy.',
    status: '~90% Complete',
    statusColor: 'blue',
    tags: ['Multi-Agent', 'Evolutionary AI', 'EGG Governance', 'Safety Research'],
    icon: Network,
    logo: 'https://cdn.builder.io/api/v1/image/assets%2Fa5bd7a5a13174e4caedb216ad01c7f84%2F3e3a4db2346e4fe58b731cb0c8de13be?format=webp&width=120&height=120',
    link: 'https://redset.app',
  },
  {
    id: 'aicp',
    name: 'AI Control Plane',
    tagline: 'Governance Orchestration Layer',
    description: 'Infrastructure sitting above AI deployments — enforcing policy, monitoring behavior, and providing override controls for autonomous systems. Designed as infrastructure, not a product. The control plane between humans and their AI.',
    status: '~70% Complete',
    statusColor: 'amber',
    tags: ['Governance', 'Orchestration', 'AI Safety', 'Infrastructure'],
    icon: Cpu,
    logo: 'https://cdn.builder.io/api/v1/image/assets%2Fa5bd7a5a13174e4caedb216ad01c7f84%2F4b30f97495ef4669bb097c8a2c479d08?format=webp&width=120&height=120',
  },
  {
    id: 'sentinel',
    name: 'Sentinel Protocol',
    tagline: 'Unified Safety Ecosystem',
    description: 'The umbrella ecosystem connecting ARES, Red Set, and AI Control Plane. Shared threat intelligence, unified scoring frameworks, and cross-tool data pipelines — turning isolated safety tools into a coherent defensive posture.',
    status: 'In Progress',
    statusColor: 'amber',
    tags: ['Ecosystem', 'AI Safety', 'Threat Intelligence', 'Multi-Tool'],
    icon: Shield,
    logo: 'https://cdn.builder.io/api/v1/image/assets%2Fa5bd7a5a13174e4caedb216ad01c7f84%2Fd4dcc018d2d049378b2bfca4599e9b55?format=webp&width=120&height=120',
  },
  {
    id: 'rsea',
    name: 'RSEA',
    tagline: 'Self-Protecting AI Agent',
    description: 'An AI agent built for self-protection and platform security within Moltbook — operating with a mandate toward beneficial outcomes. RSEA represents the applied edge of Sentinel Protocol: an agent that doesn\'t just follow safety rules, but actively enforces them within its operational context.',
    status: 'In Development',
    statusColor: 'violet',
    tags: ['Autonomous Agent', 'Self-Protection', 'Moltbook', 'Applied Safety'],
    icon: Zap,
  },
];

const STATUS_COLORS = {
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  blue:    'bg-blue-100 text-blue-800 border-blue-200',
  amber:   'bg-amber-100 text-amber-800 border-amber-200',
  violet:  'bg-violet-100 text-violet-800 border-violet-200',
};

// ============================================================
// MOCK BROWSER CHROME COMPONENT
// ============================================================
function MockBrowser({ children, url = 'labuilds.vercel.app' }) {
  return (
    <div className="rounded-2xl border border-slate-200 shadow-2xl overflow-hidden bg-white">
      {/* Browser chrome */}
      <div className="bg-slate-100 border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-amber-400" />
          <div className="w-3 h-3 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 bg-white border border-slate-200 rounded-md px-3 py-1 text-xs text-slate-500 font-mono flex items-center gap-2">
          <span className="text-emerald-600">🔒</span>
          {url}
        </div>
        <ExternalLink className="w-4 h-4 text-slate-400" />
      </div>
      {children}
    </div>
  );
}

// ============================================================
// PROJECT CARD COMPONENT
// ============================================================
function ProjectCard({ project }) {
  const Icon = project.icon;
  return (
    <div className={`bg-white border rounded-2xl p-6 hover:shadow-lg hover:border-slate-300 transition-all group ${project.featured ? 'border-indigo-200 md:col-span-2' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between mb-4">
        {project.logo
          ? <img src={project.logo} alt={project.name} className="w-10 h-10 rounded-xl object-cover border border-slate-100" />
          : <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
              <Icon className="w-5 h-5 text-white" />
            </div>
        }
        <div className="flex items-center gap-2">
          {project.featured && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border bg-indigo-100 text-indigo-700 border-indigo-200">
              ★ Featured
            </span>
          )}
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${STATUS_COLORS[project.statusColor]}`}>
            {project.status}
          </span>
        </div>
      </div>
      <h3 className="font-black text-slate-900 text-lg mb-1">{project.name}</h3>
      <p className="text-xs font-semibold text-indigo-600 mb-3 uppercase tracking-wide">{project.tagline}</p>
      <p className="text-sm text-slate-600 leading-relaxed mb-4">{project.description}</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {project.tags.map(tag => (
          <span key={tag} className="text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
            {tag}
          </span>
        ))}
      </div>
      {project.link && (
        <a href={project.link} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
          <ExternalLink className="w-3 h-3" /> {project.link.replace('https://', '')}
        </a>
      )}
    </div>
  );
}

// ============================================================
// ARTIFACT CARD COMPONENT
// ============================================================
function ArtifactCard({ artifact, onDelete }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = artifact.content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isReport = artifact.type === 'report';

  return (
    <div className={`bg-white rounded-2xl p-5 shadow-sm border transition-shadow flex flex-col ${isReport ? 'border-indigo-200' : 'border-slate-200 hover:shadow-md'}`}>
      <div className="flex justify-between items-start mb-3 gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${isReport ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
          {isReport && <Sparkles className="w-3 h-3 inline mr-1" />}
          {artifact.category}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={handleCopy} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 p-1.5 rounded-lg transition-colors" title="Copy">
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>
          <button onClick={onDelete} className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-1.5 rounded-lg transition-colors" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <h3 className="font-extrabold text-slate-900 text-base mb-2 leading-tight">{artifact.title}</h3>
      <p className="text-sm text-slate-600 mb-4 whitespace-pre-wrap leading-relaxed flex-1">{artifact.content}</p>
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {artifact.tags?.map((tag, i) => (
          <span key={i} className="text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
            #{tag.toLowerCase().replace(/\s+/g, '')}
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// AUDIO REPORT CARD — real progress bar wired to HTMLAudioElement
// ============================================================
function AudioReportCard({ report, onDelete }) {
  const [isPlaying, setIsPlaying]       = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [progress, setProgress]         = useState(0);
  const [duration, setDuration]         = useState(0);
  const [audioUrl, setAudioUrl]         = useState(null);
  const audioRef                        = useRef(null);

  // Cleanup blob URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const togglePlay = async () => {
    // If audio already loaded — just toggle play/pause
    if (audioRef.current && audioUrl) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    // First play — generate TTS audio
    setIsLoading(true);
    try {
      const url = await generateTTSAudio(report.content);
      setAudioUrl(url);

      const audio = new Audio(url);
      audioRef.current = audio;

      // Wire real playback events
      audio.addEventListener('timeupdate', () => {
        if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
      });
      audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setProgress(0);
      });
      audio.addEventListener('error', () => {
        setIsPlaying(false);
        setIsLoading(false);
      });

      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error('TTS error:', err);
      alert('Audio generation failed. Check your Gemini API key and TTS quota.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeek = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = ratio * duration;
    setProgress(ratio * 100);
  };

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="bg-slate-900 rounded-2xl p-5 shadow-lg border border-slate-800 text-white">
      <div className="flex justify-between items-start mb-4">
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border bg-indigo-900/50 text-indigo-300 border-indigo-800 flex items-center gap-1">
          <Headphones className="w-3 h-3" /> Audio Briefing
        </span>
        <button onClick={onDelete} className="text-slate-500 hover:text-red-400 transition-colors p-1">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <h3 className="font-extrabold text-lg mb-4 leading-tight">{report.title}</h3>

      <div className="bg-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-4">
          <button
            onClick={togglePlay}
            disabled={isLoading}
            className="w-12 h-12 bg-indigo-500 hover:bg-indigo-400 rounded-full flex items-center justify-center transition-colors shrink-0 disabled:opacity-50"
          >
            {isLoading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : isPlaying
                ? <Pause className="w-5 h-5 fill-white" />
                : <Play className="w-5 h-5 fill-white ml-0.5" />
            }
          </button>

          <div className="flex-1 space-y-1">
            {/* Real seekable progress bar */}
            <div
              className="h-2 bg-slate-700 rounded-full overflow-hidden cursor-pointer"
              onClick={handleSeek}
            >
              <div
                className="h-full bg-indigo-400 rounded-full transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>{formatTime(audioRef.current?.currentTime)}</span>
              <span>{duration ? formatTime(duration) : (audioUrl ? '...' : 'Click play to generate')}</span>
            </div>
          </div>
        </div>
      </div>

      <details className="mt-4 text-xs text-slate-400 cursor-pointer">
        <summary className="hover:text-slate-300 select-none">Show Transcript</summary>
        <p className="mt-2 leading-relaxed bg-slate-800/50 p-3 rounded-lg">{report.content}</p>
      </details>
    </div>
  );
}

// ============================================================
// SOURCE UPLOADER TAB
// ============================================================
function SourceUploader({ onInject, setActiveTab }) {
  const [text, setText]           = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async () => {
    if (!text.trim()) return;
    setIsUploading(true);
    setActiveTab('data');
    try {
      await onInject(null, text.trim());
    } finally {
      setIsUploading(false);
      setText('');
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
        <h3 className="font-bold text-indigo-900 text-sm mb-1">Manual Data Injection</h3>
        <p className="text-xs text-indigo-700">Paste articles, notes, or code. The AI will instantly structure it into artifacts for your workspace.</p>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste your source text here..."
        className="flex-1 min-h-[200px] w-full p-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm shadow-inner"
      />
      <button
        onClick={handleUpload}
        disabled={isUploading || !text.trim()}
        className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50 shadow-md"
      >
        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Inject to Workspace
      </button>
    </div>
  );
}

// ============================================================
// REPORT GENERATOR TAB
// ============================================================
const REPORT_TYPES = [
  { key: 'summary',      label: 'Exec Summary',    Icon: FileText,    dark: false },
  { key: 'graph',        label: 'Knowledge Graph', Icon: Network,     dark: false },
  { key: 'slides',       label: 'Slide Deck',      Icon: LayoutGrid,  dark: false },
  { key: 'audio_script', label: 'Audio Briefing',  Icon: Headphones,  dark: true  },
];

function ReportGenerator({ dataArtifacts, reportArtifacts, onGenerateReport, onDelete }) {
  const [isGenerating, setIsGenerating] = useState(null);

  const handleGenerate = async (type) => {
    if (dataArtifacts.length === 0) return;
    setIsGenerating(type);
    try {
      await onGenerateReport(type);
    } finally {
      setIsGenerating(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="font-bold text-slate-900 text-sm mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" /> Synthesis Studio
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Transform your collected artifacts into unified assets.
          {dataArtifacts.length === 0 && <span className="text-amber-600 ml-1">Capture some data first.</span>}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {REPORT_TYPES.map(({ key, label, Icon, dark }) => (
            <button
              key={key}
              onClick={() => handleGenerate(key)}
              disabled={!!isGenerating || dataArtifacts.length === 0}
              className={`px-3 py-2.5 rounded-lg text-xs font-semibold text-left flex flex-col gap-1.5 transition-colors disabled:opacity-40 border
                ${dark
                  ? 'bg-indigo-600 border-indigo-700 text-white hover:bg-indigo-700 shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200'
                }`}
            >
              {isGenerating === key
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Icon className="w-4 h-4" />
              }
              {label}
            </button>
          ))}
        </div>
      </div>

      {isGenerating && (
        <div className="bg-indigo-50 rounded-2xl p-6 border border-indigo-100 flex flex-col items-center gap-3 animate-pulse">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          <p className="text-sm font-semibold text-indigo-700">Synthesizing Asset…</p>
        </div>
      )}

      {reportArtifacts.length === 0 && !isGenerating && (
        <p className="text-center text-xs text-slate-400 mt-8">No reports generated yet.</p>
      )}

      {reportArtifacts.map(report =>
        report.type === 'audio'
          ? <AudioReportCard key={report.id} report={report} onDelete={() => onDelete(report.id)} />
          : <ArtifactCard    key={report.id} artifact={report} onDelete={() => onDelete(report.id)} />
      )}
    </div>
  );
}

// ============================================================
// ROOT APP
// ============================================================
export default function App() {
  const [artifacts, setArtifacts]         = useState([]);
  const [localTasks, setLocalTasks]       = useState([]);
  const [sessionId, setSessionId]         = useState(null);

  const [isSelectingMode, setIsSelectingMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen]     = useState(false);
  const [activeTab, setActiveTab]             = useState('data');
  const [contextMenu, setContextMenu]         = useState({ show: false, x: 0, y: 0 });
  const [selection, setSelection]             = useState({ startX: 0, startY: 0, currentX: 0, currentY: 0, active: false });
  const [isCanvasReady, setIsCanvasReady]     = useState(false);

  const contentRef = useRef(null);

  // ── 1. Session + initial data load ──────────────────────────
  useEffect(() => {
    const init = async () => {
      const id = await db.getSessionId();
      setSessionId(id);
      try {
        const data = await db.getArtifacts();
        setArtifacts(data);
      } catch (err) {
        console.error('Failed to load artifacts:', err);
      }
    };
    init();
  }, []);

  // ── 2. Supabase realtime subscription ───────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const channel = db.subscribeToArtifacts(sessionId, async () => {
      try {
        const data = await db.getArtifacts();
        setArtifacts(data);
      } catch (err) {
        console.error('Realtime sync error:', err);
      }
    });
    return () => supabase.removeChannel(channel);
  }, [sessionId]);

  // ── 3. html2canvas script loader ────────────────────────────
  useEffect(() => {
    if (window.html2canvas) { setIsCanvasReady(true); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onload = () => setIsCanvasReady(true);
    document.body.appendChild(script);

    // Also try to load Tesseract.js as an optional client-side OCR fallback
    if (!window.Tesseract) {
      const tScript = document.createElement('script');
      tScript.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/tesseract.min.js';
      tScript.async = true;
      document.body.appendChild(tScript);
    }

    return () => {
      if (document.body.contains(script)) document.body.removeChild(script);
      // keep tesseract script; removing could break cached worker state — no-op cleanup
    };
  }, []);

  // ── 4. Global hotkeys + context menu dismiss ─────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSelectingMode(prev => !prev);
        setIsSidebarOpen(false);
      }
      if (e.key === 'Escape') {
        setIsSelectingMode(false);
        setContextMenu({ show: false, x: 0, y: 0 });
        document.body.style.overflow = ''; // restore if Escape during drag
      }
    };
    const onClickOutside = () => setContextMenu({ show: false, x: 0, y: 0 });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('click', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('click', onClickOutside);
    };
  }, []);

  const handleContextMenu = (e) => {
    e.preventDefault();
    // Use clientX/Y for fixed-positioned menu (not pageX/Y — bug fix)
    setContextMenu({ show: true, x: e.clientX, y: e.clientY });
  };

  // ── 5. Selection drag state — pure viewport (client) coords ────
  // The overlay is position:fixed, so we keep EVERYTHING in viewport space.
  // We freeze body scroll during selection to prevent coordinate drift.
  // RAF loop handles edge-scroll without polluting pointer tracking.
  const rafRef       = useRef(null);
  const clientPosRef = useRef({ x: 0, y: 0 });

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  const startAutoScroll = useCallback(() => {
    stopAutoScroll();
    const loop = () => {
      const { x, y } = clientPosRef.current;
      const threshold = 60;
      const speed     = 10;
      if (y < threshold)                       window.scrollBy(0, -speed);
      if (y > window.innerHeight - threshold)  window.scrollBy(0,  speed);
      if (x < threshold)                       window.scrollBy(-speed, 0);
      if (x > window.innerWidth  - threshold)  window.scrollBy( speed, 0);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [stopAutoScroll]);

  // ── 6. Selection handlers ─────────────────────────────────────
  const handlePointerDown = (e) => {
    if (!isSelectingMode) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    clientPosRef.current = { x, y };
    // Freeze body scroll — prevents coordinate drift during drag
    document.body.style.overflow = 'hidden';
    setSelection({ startX: x, startY: y, currentX: x, currentY: y, active: true });
    startAutoScroll();
  };

  const handlePointerMove = (e) => {
    if (!selection.active) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    clientPosRef.current = { x, y };
    setSelection(prev => ({ ...prev, currentX: x, currentY: y }));
  };

  const handlePointerUp = async () => {
    if (!selection.active) return;
    stopAutoScroll();
    // Restore scrolling
    document.body.style.overflow = '';
    const left   = Math.min(selection.startX, selection.currentX);
    const top    = Math.min(selection.startY, selection.currentY);
    const width  = Math.abs(selection.currentX - selection.startX);
    const height = Math.abs(selection.currentY - selection.startY);
    setSelection(prev => ({ ...prev, active: false }));
    if (width < 15 || height < 15) { setIsSelectingMode(false); return; }
    processCapture(left, top, width, height);
  };

  // ── 7. Core capture + AI + persist pipeline ──────────────────
  // left/top/width/height are viewport (client) coords — scroll is frozen during drag.
  // We capture document.body so x/y = clientCoord + scrollOffset = document coords.
  const processCapture = async (left, top, width, height) => {
    if (!isCanvasReady) return;
    setIsSelectingMode(false);

    const taskId = `task_${Date.now()}`;
    setLocalTasks(prev => [{ id: taskId, message: 'Synthesizing visual region…' }, ...prev]);

    try {
      await new Promise(r => setTimeout(r, 50)); // flush repaint before screenshot

      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;

      // Scroll was frozen during drag so scrollX/scrollY = scroll at drag-start.
      // viewport coord + scroll = document coord — correct for html2canvas(document.body).
      const canvas = await window.html2canvas(document.body, {
        useCORS: true,
        scale: 1,
        x: left + scrollX,
        y: top  + scrollY,
        width,
        height,
        backgroundColor: null,
      });

      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      const fallbackText = await extractTextFromCanvas(canvas);
      await ingestArtifacts(base64, fallbackText, taskId);
    } catch (err) {
      console.error('[CaptureFlow] Capture error:', err);
      setLocalTasks(prev => prev.filter(t => t.id !== taskId));
    }
  };

  // Shared ingestion used by both capture and manual upload
  const ingestArtifacts = useCallback(async (base64Image, textContext, taskId) => {
    try {
      const extracted = await extractKnowledge(base64Image, textContext);

      // Bug fix: use Promise.all instead of forEach to properly await all writes
      await Promise.all(
        extracted.map(data =>
          db.saveArtifact({
            ...data,
            type: base64Image ? 'capture' : 'source',
          })
        )
      );
    } catch (err) {
      console.error('Ingestion error:', err);

      alert(
        `CaptureFlow Pipeline Error:\n\n${
          err?.message || JSON.stringify(err, null, 2)
        }`
      );
    } finally {
      setLocalTasks(prev => prev.filter(t => t.id !== taskId));
    }
  }, []);

  const handleManualInject = useCallback(async (base64, text) => {
    const taskId = `task_${Date.now()}`;
    setLocalTasks(prev => [{ id: taskId, message: 'Parsing manual input…' }, ...prev]);
    await ingestArtifacts(base64, text, taskId);
  }, [ingestArtifacts]);

  // ── Derived state ─────────────────────────────────────────────
  const dataArtifacts   = artifacts.filter(a => a.type === 'capture' || a.type === 'source');
  const reportArtifacts = artifacts.filter(a => a.type === 'report'  || a.type === 'audio');
  const totalBadge      = dataArtifacts.length + localTasks.length;

  // ── 7. Report generation ──────────────────────────────────────
  const handleGenerateReport = useCallback(async (type) => {
    try {
      const text = await generateReport(dataArtifacts, type);
      const categoryMap = {
        summary:      'Executive Summary',
        graph:        'Knowledge Graph',
        slides:       'Slide Outline',
        audio_script: 'Podcast Script',
      };
      await db.saveArtifact({
        title:    categoryMap[type],
        category: 'Generated Report',
        content:  text,
        tags:     [type, 'synthesis'],
        type:     type === 'audio_script' ? 'audio' : 'report',
      });
    } catch (err) {
      console.error('Report generation error:', err);
    }
  }, [dataArtifacts]);

  const handleDelete = useCallback(async (id) => {
    try {
      await db.deleteArtifact(id);
    } catch (err) {
      console.error('Delete error:', err);
    }
  }, []);

  const boxLeft   = Math.min(selection.startX, selection.currentX);
  const boxTop    = Math.min(selection.startY, selection.currentY);
  const boxWidth  = Math.abs(selection.currentX - selection.startX);
  const boxHeight = Math.abs(selection.currentY - selection.startY);

  // ─────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-200 relative overflow-x-hidden"
      onContextMenu={handleContextMenu}
    >

      {/* ── Hamburger (top right) ── */}
      <div className="fixed top-4 right-4 z-[45]">
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="p-2.5 bg-white text-slate-800 hover:bg-slate-100 rounded-lg shadow-sm border border-slate-200 transition-all focus:outline-none relative"
          aria-label="Open workspace"
        >
          <Menu className="w-5 h-5" />
          {totalBadge > 0 && !isSidebarOpen && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-blue-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm">
              {totalBadge}
            </span>
          )}
        </button>
      </div>

      {/* ── Start button (bottom left) ── */}
      <div className="fixed bottom-4 left-4 z-[45]">
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="p-3 bg-slate-900 text-white hover:bg-slate-800 rounded-full shadow-lg transition-transform hover:scale-105 focus:outline-none relative"
          aria-label="Open workspace"
        >
          <LayoutGrid className="w-5 h-5" />
          {totalBadge > 0 && !isSidebarOpen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-slate-900">
              {totalBadge}
            </span>
          )}
        </button>
      </div>

      {/* ── MOCK PAGE: LABuilds ── */}
      <main ref={contentRef} className="max-w-5xl mx-auto px-6 pb-32 pt-8">

        <MockBrowser url="labuilds.vercel.app">
          <div className="p-8 bg-white">

            {/* Hero */}
            <header className="mb-10 border-b border-slate-100 pb-10">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
                      <Zap className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-black text-xl tracking-tight text-slate-900">LA Builds</span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">Independent AI Systems Engineering</p>
                </div>
                <div className="flex gap-2">
                  <a href="https://github.com/Arnoldlarry15" target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                    <Github className="w-3.5 h-3.5" /> GitHub
                  </a>
                </div>
              </div>

              <h1 className="text-4xl md:text-5xl font-black text-slate-900 leading-tight mb-4">
                Building AI tools<br />
                <span className="text-indigo-600">that solve real</span><br />
                problems.
              </h1>
              <p className="text-lg text-slate-600 max-w-2xl leading-relaxed">
                Multi-agent architectures, automated red-teaming, cognitive memory interfaces, and AI governance layers. Battle-tested technology. No hypotheticals.
              </p>

              <div className="mt-6 flex items-center gap-3 flex-wrap text-sm">
                <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full font-semibold text-xs">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  3 Projects Live
                </span>
                <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full font-semibold text-xs">
                  2 In Progress
                </span>
                <span className="inline-flex items-center gap-1.5 bg-violet-50 text-violet-700 border border-violet-200 px-3 py-1.5 rounded-full font-semibold text-xs">
                  1 In Development
                </span>
              </div>
            </header>

            {/* Usage hint */}
            <div className="mb-8 bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3 flex items-center gap-3 text-sm text-indigo-800">
              <Scissors className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>
                <strong>CaptureFlow Demo:</strong> Press <kbd className="bg-white border border-indigo-200 px-1.5 py-0.5 rounded text-xs font-mono">Ctrl+F</kbd> or Right-Click anywhere to capture any section of this page into your AI workspace.
              </span>
            </div>

            {/* Project grid */}
            <section className="mb-12">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-1">Capstone Projects</p>
                  <h2 className="text-2xl font-black text-slate-900">Six systems. One ecosystem.</h2>
                </div>
                <span className="text-xs text-slate-400 font-medium">6 / 6 catalogued</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {LA_BUILDS_PROJECTS.map(project => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            </section>

            {/* About */}
            <section className="mb-12 pt-10 border-t border-slate-100">
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-1">About</p>
              <h2 className="text-2xl font-black text-slate-900 mb-6">First-principles engineering.<br />Applied to AI safety.</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <p className="text-sm text-slate-600 leading-relaxed mb-4">
                    <strong className="text-slate-900">Larry Arnold</strong> — independent AI researcher and developer, currently pursuing a B.S. in Computer Science with an Undergraduate Certificate in AI at Maryville University of St. Louis.
                  </p>
                  <p className="text-sm text-slate-600 leading-relaxed mb-4">
                    Background in <strong className="text-slate-900">LLM red teaming</strong>, adversarial prompting, and AI safety research. Building the infrastructure layer for adversarial AI, cognitive automation, and system-level control.
                  </p>

                  {/* Kitchen → Systems callout — restored */}
                  <div className="border-l-4 border-indigo-500 pl-4 py-1 my-5 bg-indigo-50 rounded-r-xl pr-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-2">// The Kitchen → Systems Connection</p>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Before AI, <strong className="text-slate-800">17 years running high-volume professional kitchens</strong> — Sous Chef, Grill Master, Sushi Chef, Kitchen Manager. A kitchen at peak service is an adversarial distributed system: <strong className="text-slate-800">parallel execution under pressure, zero tolerance for cascading failures, real-time resource allocation, human coordination at the edge of chaos.</strong> That's the same problem class as multi-agent AI governance. The discipline transferred directly.
                    </p>
                  </div>

                  <p className="text-sm text-slate-600 leading-relaxed">
                    Approach: deconstruct systems to core components, rebuild through first-principles reasoning and pattern recognition. <strong className="text-slate-900">Engineering AI systems for failure-resistant operation.</strong>
                  </p>
                </div>
                <div className="space-y-2">
                  {[
                    { icon: '🔴', name: 'LLM Red Teaming',       sub: 'Adversarial · Safety' },
                    { icon: '🤖', name: 'Multi-Agent Systems',    sub: 'Architecture · Design' },
                    { icon: '🧠', name: 'Cognitive Interfaces',   sub: 'AI-Native · UX' },
                    { icon: '🏛️', name: 'AI Governance',          sub: 'Policy · Orchestration' },
                    { icon: '⚛️', name: 'React / Full-Stack',     sub: 'Vercel · Supabase' },
                    { icon: '🍳', name: 'Systems Under Pressure', sub: '17 yrs · Ops discipline' },
                    { icon: '🎓', name: 'Maryville University',   sub: 'CS + AI Certificate' },
                  ].map(s => (
                    <div key={s.name} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-lg w-7 text-center">{s.icon}</span>
                      <span className="font-bold text-slate-900 text-sm flex-1">{s.name}</span>
                      <span className="text-xs text-slate-400 font-mono">{s.sub}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Footer */}
            <footer className="pt-8 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 flex-wrap gap-3">
              <span>© 2025 LA Builds · Larry Arnold · Independent AI Systems Engineering</span>
              <div className="flex items-center gap-4">
                <a href="https://github.com/Arnoldlarry15" target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 hover:text-slate-600 transition-colors">
                  <Github className="w-3.5 h-3.5" /> Arnoldlarry15
                </a>
                <a href="https://redset.app" target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 hover:text-slate-600 transition-colors">
                  <ExternalLink className="w-3 h-3" /> redset.app
                </a>
                <a href="mailto:labuilds@proton.me"
                  className="flex items-center gap-1 hover:text-slate-600 transition-colors">
                  labuilds@proton.me
                </a>
              </div>
            </footer>

          </div>
        </MockBrowser>
      </main>

      {/* ── Right-click context menu ── */}
      {contextMenu.show && !isSelectingMode && (
        <div
          className="fixed z-[100] bg-white border border-slate-200 shadow-xl rounded-lg py-1.5 w-56 text-sm text-slate-700 font-medium"
          // clientX/Y used here (bug fix — was pageX/Y before)
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="w-full text-left px-4 py-2.5 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-3 transition-colors"
            onClick={(e) => { e.stopPropagation(); setContextMenu({ show: false, x: 0, y: 0 }); setIsSelectingMode(true); }}
          >
            <Scissors className="w-4 h-4" /> Capture Selection
          </button>
          <div className="h-px bg-slate-100 my-1" />
          <button
            className="w-full text-left px-4 py-2.5 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-3 transition-colors"
            onClick={(e) => { e.stopPropagation(); setContextMenu({ show: false, x: 0, y: 0 }); setIsSidebarOpen(true); }}
          >
            <Library className="w-4 h-4" /> Open Workspace
          </button>
        </div>
      )}

      {/* ── Capture overlay ── */}
      {isSelectingMode && (
        <div
          className="fixed inset-0 z-[90] cursor-crosshair touch-none select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Subtle dim outside selection */}
          <div className="absolute inset-0 bg-black/10" />
          {selection.active && (
            <div
              className="absolute border-2 border-blue-500 bg-blue-500/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.08)]"
              style={{ left: boxLeft, top: boxTop, width: boxWidth, height: boxHeight }}
            />
          )}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
            <Scissors className="w-3 h-3" /> Drag to capture · Esc to cancel
          </div>
        </div>
      )}

      {/* ── Workspace Sidebar ── */}
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[500px] bg-slate-50 shadow-[-20px_0_40px_rgba(0,0,0,0.15)] z-[95] flex flex-col border-l border-slate-200 transform transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Sidebar header */}
        <div className="p-4 border-b border-slate-200 bg-white flex flex-col gap-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Brain className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="font-black text-base text-slate-900 leading-none">CaptureFlow</h2>
                <p className="text-[10px] text-slate-400 font-medium">Cognitive Intelligence Node</p>
              </div>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-lg">
            {[
              { id: 'data',    label: `Captures (${dataArtifacts.length})` },
              { id: 'reports', label: 'Reports' },
              { id: 'add',     label: '+ Inject' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeTab === tab.id ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {activeTab === 'data' && (
            <>
              {localTasks.map(t => (
                <div key={t.id} className="bg-slate-100/50 rounded-2xl p-6 border border-slate-200 border-dashed flex flex-col items-center gap-3 animate-pulse">
                  <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                  <p className="text-sm font-semibold text-slate-600 text-center">{t.message}</p>
                </div>
              ))}
              {dataArtifacts.length === 0 && localTasks.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4 pt-16">
                  <Brain className="w-10 h-10 opacity-20" />
                  <p className="text-center text-sm px-8 leading-relaxed">
                    No captures yet.<br />
                    Close this panel and drag a region to begin.
                  </p>
                </div>
              )}
              {dataArtifacts.map(a => (
                <ArtifactCard key={a.id} artifact={a} onDelete={() => handleDelete(a.id)} />
              ))}
            </>
          )}

          {activeTab === 'reports' && (
            <ReportGenerator
              dataArtifacts={dataArtifacts}
              reportArtifacts={reportArtifacts}
              onGenerateReport={handleGenerateReport}
              onDelete={handleDelete}
            />
          )}

          {activeTab === 'add' && (
            <SourceUploader onInject={handleManualInject} setActiveTab={setActiveTab} />
          )}

        </div>
      </div>
    </div>
  );
}