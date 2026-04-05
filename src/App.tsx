/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  LogOut, 
  Plus, 
  Calendar, 
  TrendingUp, 
  MessageSquare, 
  BookOpen, 
  Send,
  Loader2,
  Trash2,
  ChevronRight,
  Smile,
  Meh,
  Frown,
  Sparkles,
  History
} from 'lucide-react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  doc, 
  deleteDoc,
  where,
  limit,
  getDocs
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import Markdown from 'react-markdown';
import { format } from 'date-fns';

import { auth, db } from './firebase';
import { cn } from './lib/utils';
import { analyzeJournalEntry, queryJournalHistory } from './services/geminiService';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) message = `Database Error: ${parsed.error}`;
      } catch {
        message = this.state.error?.message || message;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center space-y-6 border border-slate-100">
            <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto">
              <Frown className="text-rose-600 w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">Oops!</h2>
              <p className="text-slate-500">{message}</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Types ---
interface JournalEntry {
  id: string;
  content: string;
  sentimentScore: number;
  sentimentLabel: string;
  moodScore: number;
  summary: string;
  analysis: string;
  createdAt: any;
}

// --- Components ---

const Auth = ({ onLogin }: { onLogin: (user: User) => void }) => {
  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      onLogin(result.user);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center space-y-6 border border-slate-100"
      >
        <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-200">
          <BookOpen className="text-white w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Lumina Journal</h1>
          <p className="text-slate-500">Your private, AI-powered space for deep reflection and emotional insight.</p>
        </div>
        <button 
          onClick={login}
          className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
          Continue with Google
        </button>
        <p className="text-xs text-slate-400">Secure, private, and encrypted-at-rest.</p>
      </motion.div>
    </div>
  );
};

const Sidebar = ({ 
  activeTab, 
  setActiveTab, 
  user, 
  onLogout 
}: { 
  activeTab: string; 
  setActiveTab: (tab: string) => void; 
  user: User;
  onLogout: () => void;
}) => {
  const tabs = [
    { id: 'journal', icon: BookOpen, label: 'Journal' },
    { id: 'dashboard', icon: TrendingUp, label: 'Insights' },
    { id: 'chat', icon: MessageSquare, label: 'Assistant' },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-64 bg-white border-r border-slate-100 flex-col h-screen sticky top-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-100">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <span className="font-bold text-xl text-slate-900 tracking-tight">Lumina</span>
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeTab === tab.id 
                  ? "bg-indigo-50 text-indigo-600" 
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <tab.icon className={cn("w-5 h-5", activeTab === tab.id ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600")} />
              <span className="font-medium">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-50">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors group">
            <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
            <button onClick={onLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-6 py-3 flex justify-between items-center z-50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-col items-center gap-1 transition-all",
              activeTab === tab.id ? "text-indigo-600" : "text-slate-400"
            )}
          >
            <tab.icon className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">{tab.label}</span>
          </button>
        ))}
        <button onClick={onLogout} className="flex flex-col items-center gap-1 text-slate-400">
          <LogOut className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Logout</span>
        </button>
      </div>
    </>
  );
};

const JournalView = ({ entries, userId }: { entries: JournalEntry[], userId: string }) => {
  const [content, setContent] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [isWriting, setIsWriting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const saveEntry = async () => {
    if (!content.trim()) return;
    setIsAnalyzing(true);
    const path = `users/${userId}/entries`;
    try {
      const analysis = await analyzeJournalEntry(content);
      await addDoc(collection(db, path), {
        content,
        sentimentScore: analysis.score,
        sentimentLabel: analysis.label,
        moodScore: analysis.moodScore,
        summary: analysis.summary,
        analysis: analysis.analysis,
        createdAt: serverTimestamp()
      });
      setContent('');
      setIsWriting(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const deleteEntry = async (id: string) => {
    const path = `users/${userId}/entries/${id}`;
    try {
      await deleteDoc(doc(db, `users/${userId}/entries`, id));
      if (selectedEntry?.id === id) setSelectedEntry(null);
      setDeletingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const startNewEntry = () => {
    setSelectedEntry(null);
    setIsWriting(true);
  };

  const closeEditor = () => {
    setSelectedEntry(null);
    setIsWriting(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 pb-20 md:pb-0">
      <header className="bg-white border-b border-slate-100 p-4 md:p-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {(selectedEntry || isWriting) && (
            <button 
              onClick={closeEditor}
              className="md:hidden p-2 -ml-2 text-slate-400 hover:text-indigo-600"
            >
              <Plus className="w-6 h-6 rotate-45" />
            </button>
          )}
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {selectedEntry ? 'Reflection' : isWriting ? 'New Entry' : 'Daily Journal'}
          </h2>
        </div>
        <div className="flex items-center gap-2 text-slate-500 text-xs md:text-sm font-medium">
          <Calendar className="w-4 h-4" />
          {format(new Date(), 'MMM do, yyyy')}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Entry List */}
        <div className={cn(
          "w-full md:w-80 border-r border-slate-100 bg-white overflow-y-auto p-4 space-y-4 transition-transform duration-300",
          (selectedEntry || isWriting) ? "hidden md:block" : "block"
        )}>
          <button 
            onClick={startNewEntry}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 mb-2"
          >
            <Plus className="w-5 h-5" /> Write New Entry
          </button>

          <AnimatePresence mode="popLayout">
            {entries.map((entry) => (
              <motion.div
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                key={entry.id}
                onClick={() => { setSelectedEntry(entry); setIsWriting(false); }}
                className={cn(
                  "w-full text-left p-4 rounded-2xl border transition-all group relative cursor-pointer",
                  selectedEntry?.id === entry.id 
                    ? "bg-indigo-50 border-indigo-100 shadow-sm" 
                    : "bg-white border-slate-100 hover:border-slate-200 hover:shadow-sm"
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {entry.createdAt ? format(new Date(entry.createdAt.seconds * 1000), 'h:mm a') : 'Just now'}
                  </span>
                  <div className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tighter",
                    entry.sentimentScore > 0 ? "bg-emerald-100 text-emerald-700" : 
                    entry.sentimentScore < 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"
                  )}>
                    {entry.sentimentLabel}
                  </div>
                </div>
                <p className="text-slate-900 font-semibold line-clamp-1 mb-1">{entry.summary || 'New Entry'}</p>
                <p className="text-slate-500 text-sm line-clamp-2 leading-relaxed">{entry.content}</p>
                
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <AnimatePresence>
                    {deletingId === entry.id ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-1 bg-rose-50 rounded-lg p-1 border border-rose-100"
                      >
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteEntry(entry.id); }}
                          className="text-[10px] font-bold text-rose-600 px-2 py-0.5 hover:bg-rose-100 rounded-md transition-colors"
                        >
                          Confirm
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                          className="text-[10px] font-bold text-slate-400 px-2 py-0.5 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          Cancel
                        </button>
                      </motion.div>
                    ) : (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeletingId(entry.id); }}
                        className="p-1.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {entries.length === 0 && (
            <div className="text-center py-12 space-y-3">
              <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                <History className="text-slate-300 w-6 h-6" />
              </div>
              <p className="text-slate-400 text-sm">No entries yet. Start writing above.</p>
            </div>
          )}
        </div>

        {/* Editor / Detail */}
        <div className={cn(
          "flex-1 overflow-y-auto bg-slate-50/50 p-4 md:p-10",
          (!selectedEntry && !isWriting) ? "hidden md:block" : "block"
        )}>
          <AnimatePresence mode="wait">
            {selectedEntry ? (
              <motion.div 
                key={selectedEntry.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-3xl mx-auto space-y-6 md:space-y-8"
              >
                <div className="flex justify-between items-center">
                  <button 
                    onClick={startNewEntry}
                    className="flex items-center gap-2 text-indigo-600 font-semibold hover:gap-3 transition-all"
                  >
                    <Plus className="w-5 h-5" /> New Entry
                  </button>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-white px-3 md:px-4 py-2 rounded-2xl shadow-sm border border-slate-100">
                      <span className="text-xs md:text-sm font-bold text-slate-500">Mood</span>
                      <div className="flex gap-0.5 md:gap-1">
                        {[...Array(10)].map((_, i) => (
                          <div 
                            key={i} 
                            className={cn(
                              "w-1.5 md:w-2 h-3 md:h-4 rounded-full",
                              i < selectedEntry.moodScore ? "bg-indigo-500" : "bg-slate-100"
                            )} 
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8 space-y-6 md:space-y-8">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Reflection</h3>
                    <p className="text-lg md:text-xl text-slate-800 leading-relaxed whitespace-pre-wrap font-medium">
                      {selectedEntry.content}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 md:pt-8 border-t border-slate-50">
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-indigo-500" /> AI Summary
                      </h3>
                      <p className="text-slate-600 leading-relaxed italic">
                        "{selectedEntry.summary}"
                      </p>
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-indigo-500" /> Emotional Analysis
                      </h3>
                      <div className="text-slate-600 text-sm leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        {selectedEntry.analysis}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-3xl mx-auto h-full flex flex-col"
              >
                <div className="flex-1 flex flex-col space-y-6">
                  <div className="space-y-2 text-center mb-4 md:mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">How was your day?</h1>
                    <p className="text-slate-500 text-sm md:text-base">Write freely. Lumina will help you find the patterns in your emotions.</p>
                  </div>
                  
                  <div className="relative flex-1 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Start typing your thoughts here..."
                      className="flex-1 w-full p-6 md:p-8 text-lg md:text-xl text-slate-800 placeholder:text-slate-300 focus:outline-none resize-none leading-relaxed font-medium"
                    />
                    <div className="p-4 md:p-6 bg-slate-50 border-t border-slate-100 flex flex-col md:flex-row gap-4 justify-between items-center">
                      <div className="flex items-center gap-4 text-slate-400 text-xs md:text-sm">
                        <span className="flex items-center gap-1"><Smile className="w-4 h-4" /> Positive</span>
                        <span className="flex items-center gap-1"><Meh className="w-4 h-4" /> Neutral</span>
                        <span className="flex items-center gap-1"><Frown className="w-4 h-4" /> Negative</span>
                      </div>
                      <button
                        onClick={saveEntry}
                        disabled={isAnalyzing || !content.trim()}
                        className="w-full md:w-auto flex items-center justify-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-2xl font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-100 active:scale-95"
                      >
                        {isAnalyzing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Send className="w-5 h-5" />
                            Save Reflection
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const DashboardView = ({ entries }: { entries: JournalEntry[] }) => {
  const chartData = [...entries].reverse().map(e => ({
    date: format(new Date(e.createdAt?.seconds * 1000 || Date.now()), 'MMM d'),
    mood: e.moodScore,
    sentiment: (e.sentimentScore + 1) * 5, // Normalize -1..1 to 0..10
  }));

  const averageMood = entries.length > 0 
    ? (entries.reduce((acc, curr) => acc + curr.moodScore, 0) / entries.length).toFixed(1)
    : 0;

  const positiveEntries = entries.filter(e => e.sentimentScore > 0).length;
  const negativeEntries = entries.filter(e => e.sentimentScore < 0).length;

  return (
    <div className="flex-1 bg-slate-50 p-4 md:p-10 overflow-y-auto pb-24 md:pb-10">
      <div className="max-w-6xl mx-auto space-y-6 md:space-y-10">
        <header className="space-y-2">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">Emotional Insights</h2>
          <p className="text-slate-500 font-medium text-sm md:text-base">Visualizing your journey over the past {entries.length} entries.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Average Mood</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl md:text-5xl font-black text-indigo-600">{averageMood}</span>
              <span className="text-slate-400 font-bold text-sm">/ 10</span>
            </div>
          </div>
          <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Positive Days</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl md:text-5xl font-black text-emerald-500">{positiveEntries}</span>
              <span className="text-slate-400 font-bold text-sm">entries</span>
            </div>
          </div>
          <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Negative Days</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl md:text-5xl font-black text-rose-500">{negativeEntries}</span>
              <span className="text-slate-400 font-bold text-sm">entries</span>
            </div>
          </div>
        </div>

        {entries.length > 1 ? (
          <div className="bg-white p-4 md:p-8 rounded-3xl shadow-sm border border-slate-100 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h3 className="text-lg md:text-xl font-bold text-slate-900">Mood & Sentiment Trends</h3>
              <div className="flex gap-4 text-[10px] md:text-xs font-bold uppercase tracking-widest">
                <span className="flex items-center gap-2 text-indigo-500"><div className="w-3 h-3 rounded-full bg-indigo-500" /> Mood</span>
                <span className="flex items-center gap-2 text-emerald-500"><div className="w-3 h-3 rounded-full bg-emerald-500" /> Sentiment</span>
              </div>
            </div>
            <div className="h-[300px] md:h-[400px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorMood" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                    dy={10}
                  />
                  <YAxis 
                    domain={[0, 10]} 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '16px', 
                      border: 'none', 
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                      padding: '12px'
                    }} 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="mood" 
                    stroke="#6366f1" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorMood)" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="sentiment" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorSent)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="bg-white p-12 md:p-20 rounded-3xl shadow-sm border border-slate-100 text-center space-y-4">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
              <TrendingUp className="text-slate-300 w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-900">Not enough data yet</h3>
              <p className="text-slate-500 max-w-xs mx-auto">Write at least two journal entries to start seeing your emotional trends visualized.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ChatAssistant = ({ entries }: { entries: JournalEntry[] }) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!query.trim()) return;
    const userMsg = query;
    setQuery('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const response = await queryJournalHistory(userMsg, entries);
      setMessages(prev => [...prev, { role: 'ai', content: response }]);
    } catch (error) {
      console.error("Chat failed:", error);
      setMessages(prev => [...prev, { role: 'ai', content: "I'm sorry, I encountered an error while analyzing your history." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 pb-20 md:pb-0">
      <header className="bg-white border-b border-slate-100 p-4 md:p-6">
        <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-indigo-600" />
          Assistant
        </h2>
        <p className="text-slate-500 text-xs md:text-sm font-medium">Ask me anything about your past month's entries.</p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto text-center py-10 md:py-20 space-y-6">
            <div className="w-16 h-16 md:w-20 md:h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto">
              <Sparkles className="text-indigo-600 w-8 h-8 md:w-10 md:h-10" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl md:text-2xl font-bold text-slate-900">How can I help you reflect?</h3>
              <p className="text-slate-500 text-sm md:text-base">I have access to your journal history. Try asking:</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 md:gap-3">
              {[
                "How has my mood been lately?",
                "What were the highlights of last week?",
                "Summarize my emotional state this month."
              ].map((q, i) => (
                <button 
                  key={i}
                  onClick={() => setQuery(q)}
                  className="bg-white border border-slate-200 px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-xs md:text-sm font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg, i) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={i}
              className={cn(
                "flex",
                msg.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              <div className={cn(
                "max-w-[90%] md:max-w-[85%] p-4 md:p-5 rounded-3xl text-sm leading-relaxed",
                msg.role === 'user' 
                  ? "bg-indigo-600 text-white rounded-tr-none shadow-lg shadow-indigo-100" 
                  : "bg-white text-slate-700 rounded-tl-none border border-slate-100 shadow-sm"
              )}>
                {msg.role === 'ai' ? (
                  <div className="prose prose-slate prose-sm max-w-none prose-p:leading-relaxed prose-li:leading-relaxed">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-100 p-4 md:p-5 rounded-3xl rounded-tl-none shadow-sm">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 md:p-6 bg-white border-t border-slate-100">
        <div className="max-w-3xl mx-auto relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask your assistant..."
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 md:px-6 md:py-4 pr-14 md:pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-sm md:text-base"
          />
          <button
            onClick={handleSend}
            disabled={!query.trim() || isLoading}
            className="absolute right-1.5 md:right-2 top-1.5 md:top-2 bottom-1.5 md:bottom-2 bg-indigo-600 text-white px-3 md:px-4 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all"
          >
            <Send className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('journal');
  const [entries, setEntries] = useState<JournalEntry[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, `users/${user.uid}/entries`), 
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as JournalEntry[];
      setEntries(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/entries`);
    });
    return () => unsubscribe();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  return (
    <ErrorBoundary>
      <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
        <Sidebar 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          user={user} 
          onLogout={() => signOut(auth)} 
        />
        
        <main className="flex-1 flex flex-col h-screen overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === 'journal' && (
              <motion.div 
                key="journal"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 h-full"
              >
                <JournalView entries={entries} userId={user.uid} />
              </motion.div>
            )}
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 h-full"
              >
                <DashboardView entries={entries} />
              </motion.div>
            )}
            {activeTab === 'chat' && (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 h-full"
              >
                <ChatAssistant entries={entries} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </ErrorBoundary>
  );
}
