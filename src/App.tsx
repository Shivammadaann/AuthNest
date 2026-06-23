import React, { Component, startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Folder,
  FolderPlus,
  Globe,
  Info,
  KeyRound,
  LifeBuoy,
  Link2,
  Lock,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  QrCode,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { QRScanner } from './components/QRScanner';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Toaster } from './components/ui/sonner';
import { auth, db } from './firebase';
import { buildOtpauthUri, isBase32Secret, normalizeSecret, parseOtpauthPayload } from './lib/otpauth';
import { scorePasswordStrength, type PasswordStrength } from './lib/passwords';
import { generateTOTP, getRemainingSeconds } from './lib/totp';
import authenticatorIcon from '../icons/authenticator.svg';
import appleIcon from '../icons/platforms/Apple Logo.png';
import facebookIcon from '../icons/platforms/Facebook.svg';
import googleIcon from '../icons/platforms/Google.svg';
import icloudIcon from '../icons/platforms/iCloud Logo.png';
import instagramIcon from '../icons/platforms/Instagram Logo.png';
import messengerIcon from '../icons/platforms/Messenger.svg';
import metaIcon from '../icons/platforms/Meta.svg';
import microsoftIcon from '../icons/platforms/Microsoft.svg';
import spotifyIcon from '../icons/platforms/Spotify Logo.png';
import telegramIcon from '../icons/platforms/Telegram.png';
import tiktokIcon from '../icons/platforms/Tiktok.svg';
import whatsappIcon from '../icons/platforms/WhatsApp.svg';
import youtubeIcon from '../icons/platforms/Youtube Logo.png';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateEmail,
  updatePassword,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

interface Account {
  id: string;
  docId?: string;
  issuer: string;
  name: string;
  secret: string;
  userId: string;
  folderId?: string | null;
  vaultItemId?: string | null;
  createdAt?: Timestamp | null;
}

interface PasswordRecord {
  id: string;
  docId?: string;
  title: string;
  accountName?: string | null;
  username: string;
  password: string;
  url?: string | null;
  notes?: string | null;
  userId: string;
  folderId?: string | null;
  createdAt?: Timestamp | null;
}

interface FolderType {
  id: string;
  docId?: string;
  name: string;
  userId: string;
  createdAt?: Timestamp | null;
}

interface VaultItem {
  password: PasswordRecord;
  account: Account | null;
  folder: FolderType | undefined;
  strength: PasswordStrength;
}

interface VaultFormState {
  entryType: VaultEntryType;
  platform: string;
  username: string;
  password: string;
  loginUrl: string;
  folderId: string;
  remarks: string;
  totpIssuer: string;
  totpUsername: string;
  totpSecret: string;
  totpMethod: AuthenticatorMethod;
}

interface AuthenticatorFormState {
  issuer: string;
  accountName: string;
  secret: string;
}

interface AuthenticatorDialogTarget {
  password: PasswordRecord | null;
  account: Account | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

type AppPage = 'vault' | 'settings' | 'help';
type AuthMode = 'signin' | 'signup';
type SettingsSection = 'profile' | 'security' | 'vault' | 'appearance';
type AuthenticatorMethod = 'secret' | 'scan';
type VaultEntryType = 'credentials' | 'authenticator' | 'both';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  WRITE = 'write',
}

const APP_NAME = 'Auth Nest';

const INITIAL_VAULT_FORM: VaultFormState = {
  entryType: 'credentials',
  platform: '',
  username: '',
  password: '',
  loginUrl: '',
  folderId: '',
  remarks: '',
  totpIssuer: '',
  totpUsername: '',
  totpSecret: '',
  totpMethod: 'secret',
};

const INITIAL_AUTHENTICATOR_FORM: AuthenticatorFormState = {
  issuer: '',
  accountName: '',
  secret: '',
};

const SERVICE_ICONS: Array<{
  name: string;
  icon: string;
  aliases: string[];
}> = [
  { name: 'Instagram', icon: instagramIcon, aliases: ['instagram', 'insta'] },
  { name: 'Facebook', icon: facebookIcon, aliases: ['facebook', 'fb.com'] },
  { name: 'Messenger', icon: messengerIcon, aliases: ['messenger'] },
  { name: 'Meta', icon: metaIcon, aliases: ['meta', 'meta platforms', 'meta.com', 'meta business', 'meta verified'] },
  { name: 'Google', icon: googleIcon, aliases: ['google', 'gmail', 'googlemail'] },
  { name: 'YouTube', icon: youtubeIcon, aliases: ['youtube', 'youtu.be'] },
  { name: 'Microsoft', icon: microsoftIcon, aliases: ['microsoft', 'office 365', 'office365', 'outlook', 'hotmail', 'live.com', 'azure', 'xbox'] },
  { name: 'iCloud', icon: icloudIcon, aliases: ['icloud'] },
  { name: 'Apple', icon: appleIcon, aliases: ['apple', 'appleid'] },
  { name: 'WhatsApp', icon: whatsappIcon, aliases: ['whatsapp'] },
  { name: 'Spotify', icon: spotifyIcon, aliases: ['spotify'] },
  { name: 'Telegram', icon: telegramIcon, aliases: ['telegram'] },
  { name: 'TikTok', icon: tiktokIcon, aliases: ['tiktok', 'tik tok'] },
];

const PAGE_CONFIG: Record<
  AppPage,
  {
    hash: string;
    label: string;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  vault: {
    hash: '#/vault',
    label: 'Vault',
    title: 'Vault',
    description: 'Store credentials and authenticator keys for each account.',
    icon: KeyRound,
  },
  settings: {
    hash: '#/settings',
    label: 'Settings',
    title: 'Settings',
    description: 'Manage your account, security preferences, folders, backups, and appearance.',
    icon: Settings2,
  },
  help: {
    hash: '#/help',
    label: 'Help and Support',
    title: 'Help and Support',
    description: 'Setup guides, vault help, authenticator instructions, and support direction.',
    icon: LifeBuoy,
  },
};

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'vault', label: 'Vault', icon: Folder },
  { id: 'appearance', label: 'Appearance', icon: Sun },
];

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getPageFromHash(hash: string): AppPage {
  const normalizedHash = hash.toLowerCase() || PAGE_CONFIG.vault.hash;
  const match = Object.entries(PAGE_CONFIG).find(([, page]) => page.hash === normalizedHash);
  return (match?.[0] as AppPage) || 'vault';
}

function getTimestampMs(timestamp?: Timestamp | null) {
  return timestamp instanceof Timestamp ? timestamp.toMillis() : 0;
}

function formatDate(timestamp?: Timestamp | null) {
  if (!(timestamp instanceof Timestamp)) {
    return 'Just now';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp.toDate());
}

function normalizeLoginUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Use an http or https login URL.');
  }

  return parsed.toString();
}

function openExternalUrl(value?: string | null) {
  if (!value) {
    return;
  }

  const target = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  window.open(target, '_blank', 'noopener,noreferrer');
}

function buildInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'AN';
}

function buildSeedHue(value: string) {
  return value.split('').reduce((total, char) => total + char.charCodeAt(0), 0) % 360;
}

function findServiceIcon(value: string) {
  const searchableValue = value.toLowerCase();
  return SERVICE_ICONS.find((service) =>
    service.aliases.some((alias) => {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp(`(^|[^a-z0-9])${escapedAlias}([^a-z0-9]|$)`, 'i').test(searchableValue);
    }),
  );
}

function getPageTitle(user: FirebaseUser | null, page: AppPage) {
  if (!user) {
    return `${APP_NAME} | Sign In`;
  }

  return `${APP_NAME} | ${PAGE_CONFIG[page].title}`;
}

async function copyToClipboard(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch (error) {
    console.error(error);
    toast.error('Copy failed.');
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string) {
  const diagnostic = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    userId: auth.currentUser?.uid,
    email: auth.currentUser?.email,
  };

  console.error('Firestore error', diagnostic);
  return diagnostic;
}

function getFirestoreActionErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : null;

  if (code === 'permission-denied') {
    return 'This action was blocked by your Firestore security rules.';
  }

  return error instanceof Error ? error.message : 'This action could not be completed.';
}

function getAuthErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : null;

  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email address is already registered.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/missing-password':
      return 'Enter your password.';
    case 'auth/operation-not-allowed':
      return 'Enable Email/Password in Firebase Authentication to use this sign-in method.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was closed before completion.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    default:
      return error instanceof Error ? error.message : 'Authentication failed.';
  }
}

function getFirebaseActionError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : null;

  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email address is already in use.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/requires-recent-login':
      return 'For security, sign out and sign back in before changing this information.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/missing-password':
      return 'Enter a new password.';
    default:
      return error instanceof Error ? error.message : 'Unable to save changes.';
  }
}

async function resizeImageFileToDataUrl(file: File, size = 192) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image.'));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error('Failed to load image.'));
    nextImage.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare image.');
  }

  context.clearRect(0, 0, size, size);

  const scale = Math.min(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = (size - width) / 2;
  const y = (size - height) / 2;

  context.drawImage(image, x, y, width, height);
  return canvas.toDataURL('image/png', 0.92);
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('App crashed', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
          <Card className="w-full max-w-lg rounded-[2rem] border border-border bg-background/75 px-6 py-8 shadow-2xl backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-3">
                <h1 className="text-xl font-semibold">Something went wrong</h1>
                <p className="text-sm text-muted-foreground">
                  Reload the app. If the issue persists, check the browser console for the recorded error details.
                </p>
              </div>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const { resolvedTheme, setTheme } = useTheme();
  const theme = resolvedTheme === 'light' ? 'light' : 'dark';
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>(() => {
    if (typeof window === 'undefined') {
      return 'vault';
    }

    return getPageFromHash(window.location.hash);
  });
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('profile');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [vaultSearch, setVaultSearch] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>('all');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [passwords, setPasswords] = useState<PasswordRecord[]>([]);
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(getRemainingSeconds());
  const [vaultDialogOpen, setVaultDialogOpen] = useState(false);
  const [editingVaultItem, setEditingVaultItem] = useState<PasswordRecord | null>(null);
  const [pendingLinkAccountId, setPendingLinkAccountId] = useState<string | null>(null);
  const [vaultForm, setVaultForm] = useState<VaultFormState>(INITIAL_VAULT_FORM);
  const [authenticatorDialogOpen, setAuthenticatorDialogOpen] = useState(false);
  const [authenticatorTarget, setAuthenticatorTarget] = useState<AuthenticatorDialogTarget | null>(null);
  const [authenticatorMethod, setAuthenticatorMethod] = useState<AuthenticatorMethod>('secret');
  const [authenticatorForm, setAuthenticatorForm] = useState<AuthenticatorFormState>(INITIAL_AUTHENTICATOR_FORM);
  const [authenticatorSaving, setAuthenticatorSaving] = useState(false);
  const [scanningQrFile, setScanningQrFile] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [qrPreviewAccount, setQrPreviewAccount] = useState<Account | null>(null);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profilePhotoDataUrl, setProfilePhotoDataUrl] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [securityEmail, setSecurityEmail] = useState('');
  const [securityPassword, setSecurityPassword] = useState('');
  const [securityConfirmPassword, setSecurityConfirmPassword] = useState('');
  const [securitySubmitting, setSecuritySubmitting] = useState(false);
  const deferredVaultSearch = useDeferredValue(vaultSearch);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test/connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error('Firebase appears to be offline. Check your configuration.');
        }
      }
    };

    void testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!window.location.hash || window.location.hash === '#/home' || window.location.hash === '#/generator') {
      window.history.replaceState(null, '', PAGE_CONFIG.vault.hash);
    }

    const handleHashChange = () => {
      startTransition(() => {
        setActivePage(getPageFromHash(window.location.hash));
      });
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    document.title = getPageTitle(user, activePage);
  }, [activePage, user]);

  useEffect(() => {
    if (!user) {
      setAccounts([]);
      setPasswords([]);
      setFolders([]);
      return;
    }

    setProfileDisplayName(user.displayName || '');
    setProfilePhotoDataUrl(user.photoURL || '');
    setSecurityEmail(user.email || '');
    setSecurityPassword('');
    setSecurityConfirmPassword('');
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const passwordQuery = query(collection(db, 'passwords'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(
      passwordQuery,
      (snapshot) => {
        setPasswords(
          snapshot.docs.map((snapshotDoc) => ({
            ...(snapshotDoc.data() as Omit<PasswordRecord, 'docId'>),
            docId: snapshotDoc.id,
          })),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'passwords');
      },
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const accountQuery = query(collection(db, 'accounts'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(
      accountQuery,
      (snapshot) => {
        setAccounts(
          snapshot.docs.map((snapshotDoc) => ({
            ...(snapshotDoc.data() as Omit<Account, 'docId'>),
            docId: snapshotDoc.id,
          })),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'accounts');
      },
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const folderQuery = query(collection(db, 'folders'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(
      folderQuery,
      (snapshot) => {
        setFolders(
          snapshot.docs.map((snapshotDoc) => ({
            ...(snapshotDoc.data() as Omit<FolderType, 'docId'>),
            docId: snapshotDoc.id,
          })),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'folders');
      },
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const updateCodes = async () => {
      const nextCodes: Record<string, string> = {};
      for (const account of accounts) {
        nextCodes[account.id] = await generateTOTP(account.secret);
      }

      if (!cancelled) {
        setCodes(nextCodes);
      }
    };

    void updateCodes();

    return () => {
      cancelled = true;
    };
  }, [accounts]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextRemaining = getRemainingSeconds();
      setRemaining(nextRemaining);

      if (nextRemaining === 30) {
        void (async () => {
          const nextCodes: Record<string, string> = {};
          for (const account of accounts) {
            nextCodes[account.id] = await generateTOTP(account.secret);
          }
          setCodes(nextCodes);
        })();
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [accounts]);

  const folderMap = useMemo(() => {
    return new Map(folders.map((folder) => [folder.id, folder]));
  }, [folders]);

  const sortedPasswords = useMemo(() => {
    return [...passwords].sort((left, right) => getTimestampMs(right.createdAt) - getTimestampMs(left.createdAt));
  }, [passwords]);

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((left, right) => getTimestampMs(right.createdAt) - getTimestampMs(left.createdAt));
  }, [accounts]);

  const passwordIdSet = useMemo(() => {
    return new Set(sortedPasswords.map((password) => password.id));
  }, [sortedPasswords]);

  const accountByVaultId = useMemo(() => {
    const nextMap = new Map<string, Account>();

    for (const account of sortedAccounts) {
      if (account.vaultItemId && !nextMap.has(account.vaultItemId)) {
        nextMap.set(account.vaultItemId, account);
      }
    }

    return nextMap;
  }, [sortedAccounts]);

  const vaultItems = useMemo<VaultItem[]>(() => {
    return sortedPasswords.map((password) => ({
      password,
      account: accountByVaultId.get(password.id) || null,
      folder: password.folderId ? folderMap.get(password.folderId) : undefined,
      strength: scorePasswordStrength(password.password),
    }));
  }, [accountByVaultId, folderMap, sortedPasswords]);

  const normalizedSearch = deferredVaultSearch.trim().toLowerCase();

  const filteredVaultItems = useMemo(() => {
    return vaultItems.filter((item) => {
      const matchesFolder = selectedFolderId === 'all' || item.password.folderId === selectedFolderId;
      if (!matchesFolder) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        item.password.title,
        item.password.accountName,
        item.password.username,
        item.password.url,
        item.password.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, selectedFolderId, vaultItems]);

  const orphanAccounts = useMemo(() => {
    return sortedAccounts.filter((account) => {
      const matchesFolder = selectedFolderId === 'all' || account.folderId === selectedFolderId;
      if (!matchesFolder) {
        return false;
      }

      const isOrphan = !account.vaultItemId || !passwordIdSet.has(account.vaultItemId);
      if (!isOrphan) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = `${account.issuer} ${account.name}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, passwordIdSet, selectedFolderId, sortedAccounts]);

  const navigateToPage = (page: AppPage) => {
    setMobileSidebarOpen(false);

    if (window.location.hash !== PAGE_CONFIG[page].hash) {
      window.location.hash = PAGE_CONFIG[page].hash;
      return;
    }

    startTransition(() => {
      setActivePage(page);
    });
  };

  const resetCredentialForm = () => {
    setAuthEmail('');
    setAuthPassword('');
    setAuthConfirmPassword('');
  };

  const handleCredentialAuth = async () => {
    const email = authEmail.trim();

    if (!email) {
      toast.error('Enter your email address.');
      return;
    }

    if (!authPassword) {
      toast.error('Enter your password.');
      return;
    }

    if (authMode === 'signup') {
      if (authPassword.length < 6) {
        toast.error('Password must be at least 6 characters.');
        return;
      }

      if (authPassword !== authConfirmPassword) {
        toast.error('Passwords do not match.');
        return;
      }
    }

    setAuthSubmitting(true);

    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, authPassword);
        toast.success('Account created successfully.');
      } else {
        await signInWithEmailAndPassword(auth, email, authPassword);
        toast.success('Logged in successfully.');
      }

      resetCredentialForm();
    } catch (error) {
      console.error(error);
      toast.error(getAuthErrorMessage(error));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthSubmitting(true);

    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      toast.success('Logged in successfully.');
    } catch (error) {
      console.error(error);
      toast.error(getAuthErrorMessage(error));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSignOutDialogOpen(false);
      setMobileSidebarOpen(false);
      setVaultDialogOpen(false);
      setAuthenticatorDialogOpen(false);
      setImportDialogOpen(false);
      toast.success('Logged out.');
    } catch (error) {
      console.error(error);
      toast.error('Sign out failed.');
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const openCreateVaultDialog = (prefill?: Partial<VaultFormState>, linkAccount?: Account | null) => {
    navigateToPage('vault');
    setEditingVaultItem(null);
    setPendingLinkAccountId(linkAccount?.id || null);
    setVaultForm({
      ...INITIAL_VAULT_FORM,
      folderId: selectedFolderId !== 'all' ? selectedFolderId : '',
      ...prefill,
    });
    setVaultDialogOpen(true);
  };

  const openEditVaultDialog = (item: VaultItem) => {
    navigateToPage('vault');
    setEditingVaultItem(item.password);
    setPendingLinkAccountId(null);
    setVaultForm({
      entryType: 'credentials',
      platform: item.password.title,
      username: item.password.username,
      password: item.password.password,
      loginUrl: item.password.url || '',
      folderId: item.password.folderId || '',
      remarks: item.password.notes || '',
      totpIssuer: item.account?.issuer || item.password.title,
      totpUsername: item.account?.name || item.password.accountName || item.password.username,
      totpSecret: item.account?.secret || '',
      totpMethod: 'secret',
    });
    setVaultDialogOpen(true);
  };

  const resetVaultDialog = () => {
    setVaultDialogOpen(false);
    setEditingVaultItem(null);
    setPendingLinkAccountId(null);
    setVaultForm(INITIAL_VAULT_FORM);
  };

  const handleSaveVaultItem = async () => {
    if (!user) {
      return;
    }

    const shouldSaveCredentials = Boolean(editingVaultItem) || Boolean(pendingLinkAccountId) || vaultForm.entryType === 'credentials' || vaultForm.entryType === 'both';
    const shouldCreateAuthenticator = !editingVaultItem && !pendingLinkAccountId && (vaultForm.entryType === 'authenticator' || vaultForm.entryType === 'both');
    const platform = vaultForm.platform.trim();
    const username = vaultForm.username.trim();
    const passwordValue = vaultForm.password.trim();
    const folderId = vaultForm.folderId || null;

    if (shouldSaveCredentials && (!platform || !username || !passwordValue)) {
      toast.error('Platform, Email / Username, and Password are required.');
      return;
    }

    let loginUrl: string | null = null;

    if (shouldSaveCredentials) {
      try {
        loginUrl = normalizeLoginUrl(vaultForm.loginUrl);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Enter a valid login URL.');
        return;
      }
    }

    const authenticatorIssuer = vaultForm.entryType === 'both' ? platform : vaultForm.totpIssuer.trim();
    const authenticatorName = vaultForm.entryType === 'both' ? username : vaultForm.totpUsername.trim();
    const authenticatorSecret = normalizeSecret(vaultForm.totpSecret);

    if (shouldCreateAuthenticator) {
      if (!authenticatorIssuer || !authenticatorName) {
        toast.error('Issuer Name and Username/Email are required for the authenticator key.');
        return;
      }

      if (!authenticatorSecret) {
        toast.error(vaultForm.totpMethod === 'scan' ? 'Scan a QR code before saving the authenticator key.' : 'Secret Key is required.');
        return;
      }

      if (!isBase32Secret(authenticatorSecret)) {
        toast.error('Use a valid Base32 secret key.');
        return;
      }
    }

    const basePayload = shouldSaveCredentials
      ? {
          title: platform,
          accountName: username,
          username,
          password: passwordValue,
          url: loginUrl,
          notes: vaultForm.remarks.trim() || null,
          folderId,
          userId: user.uid,
        }
      : null;

    try {
      if (editingVaultItem?.docId) {
        if (!basePayload) {
          return;
        }

        const batch = writeBatch(db);
        batch.update(doc(db, 'passwords', editingVaultItem.docId), basePayload);

        const linkedAccount = accountByVaultId.get(editingVaultItem.id);
        if (linkedAccount?.docId) {
          batch.update(doc(db, 'accounts', linkedAccount.docId), {
            issuer: platform,
            name: username,
            folderId,
            vaultItemId: editingVaultItem.id,
          });
        }

        await batch.commit();
        toast.success('Account updated.');
      } else if (shouldSaveCredentials) {
        if (!basePayload) {
          return;
        }

        const batch = writeBatch(db);
        const nextVaultItemId = createId();
        const passwordRef = doc(collection(db, 'passwords'));
        batch.set(passwordRef, {
          id: nextVaultItemId,
          ...basePayload,
          createdAt: serverTimestamp(),
        });

        if (pendingLinkAccountId) {
          const linkedAccount = accounts.find((account) => account.id === pendingLinkAccountId && account.docId);
          if (linkedAccount?.docId) {
            batch.update(doc(db, 'accounts', linkedAccount.docId), {
              issuer: platform,
              name: username,
              folderId,
              vaultItemId: nextVaultItemId,
            });
          }
        }

        if (shouldCreateAuthenticator) {
          const accountRef = doc(collection(db, 'accounts'));
          batch.set(accountRef, {
            id: createId(),
            issuer: authenticatorIssuer,
            name: authenticatorName,
            secret: authenticatorSecret,
            userId: user.uid,
            folderId,
            vaultItemId: nextVaultItemId,
            createdAt: serverTimestamp(),
          });
        }

        await batch.commit();
        toast.success(shouldCreateAuthenticator ? 'Account and authenticator key saved.' : 'Account credentials saved.');
      } else {
        await addDoc(collection(db, 'accounts'), {
          id: createId(),
          issuer: authenticatorIssuer,
          name: authenticatorName,
          secret: authenticatorSecret,
          userId: user.uid,
          folderId,
          vaultItemId: null,
          createdAt: serverTimestamp(),
        });
        toast.success('Authenticator key created.');
      }

      resetVaultDialog();
    } catch (error) {
      console.error('Account save failed', handleFirestoreError(error, editingVaultItem ? OperationType.UPDATE : OperationType.CREATE, shouldSaveCredentials ? 'passwords' : 'accounts'));
      toast.error(getFirestoreActionErrorMessage(error));
    }
  };

  const handleDeleteVaultItem = async (item: VaultItem) => {
    if (!item.password.docId) {
      return;
    }

    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'passwords', item.password.docId));

      if (item.account?.docId) {
        batch.delete(doc(db, 'accounts', item.account.docId));
      }

      await batch.commit();
      toast.success('Account removed.');
    } catch (error) {
      console.error('Vault delete failed', handleFirestoreError(error, OperationType.DELETE, 'passwords'));
      toast.error(getFirestoreActionErrorMessage(error));
    }
  };

  const openAuthenticatorDialog = (password: PasswordRecord | null, account: Account | null) => {
    const fallbackIssuer = password?.title || account?.issuer || 'Authenticator';
    const fallbackName = password?.accountName || password?.username || account?.name || '';

    setAuthenticatorTarget({ password, account });
    setAuthenticatorMethod('secret');
    setAuthenticatorForm({
      issuer: account?.issuer || fallbackIssuer,
      accountName: account?.name || fallbackName,
      secret: account?.secret || '',
    });
    setAuthenticatorDialogOpen(true);
  };

  const resetAuthenticatorDialog = () => {
    setAuthenticatorDialogOpen(false);
    setAuthenticatorTarget(null);
    setAuthenticatorMethod('secret');
    setAuthenticatorForm(INITIAL_AUTHENTICATOR_FORM);
    setAuthenticatorSaving(false);
    setScanningQrFile(false);
  };

  const applyDecodedAuthenticatorValue = (decodedText: string, target: 'authenticator' | 'vault' = 'authenticator') => {
    try {
      const parsed = parseOtpauthPayload(decodedText);

      if (!parsed) {
        toast.error('No authenticator data was found.');
        return;
      }

      if (target === 'vault') {
        setVaultForm((current) => {
          const parsedIssuer = parsed.issuer && parsed.issuer !== 'Authenticator' ? parsed.issuer : '';
          const parsedAccountName = parsed.accountName || '';

          return {
            ...current,
            platform: current.entryType === 'both' ? current.platform || parsedIssuer : current.platform,
            username: current.entryType === 'both' ? current.username || parsedAccountName : current.username,
            totpIssuer: parsedIssuer || current.totpIssuer,
            totpUsername: parsedAccountName || current.totpUsername,
            totpSecret: parsed.secret,
          };
        });
      } else {
        setAuthenticatorForm((current) => ({
          issuer: parsed.issuer && parsed.issuer !== 'Authenticator' ? parsed.issuer : current.issuer,
          accountName: parsed.accountName || current.accountName,
          secret: parsed.secret,
        }));
        setAuthenticatorMethod('secret');
      }

      toast.success('Authenticator details captured from QR code.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to read that QR code.');
    }
  };

  const handleQrFileUpload = async (file?: File | null, target: 'authenticator' | 'vault' = 'authenticator') => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Upload an image file containing the QR code.');
      return;
    }

    setScanningQrFile(true);

    try {
      const readerElementId = 'authenticator-file-reader';
      const readerElement = document.getElementById(readerElementId);
      if (readerElement) {
        readerElement.innerHTML = '';
      }

      const scanner = new Html5Qrcode(readerElementId);
      const decodedText = await scanner.scanFile(file, false);
      if (readerElement) {
        readerElement.innerHTML = '';
      }
      applyDecodedAuthenticatorValue(decodedText, target);
    } catch (error) {
      console.error(error);
      toast.error('Unable to decode that QR image.');
    } finally {
      setScanningQrFile(false);
    }
  };

  const handleSaveAuthenticator = async () => {
    if (!user || !authenticatorTarget) {
      return;
    }

    const issuer = authenticatorForm.issuer.trim() || authenticatorTarget.password?.title || 'Authenticator';
    const accountName = authenticatorForm.accountName.trim() || authenticatorTarget.password?.accountName || authenticatorTarget.password?.username || '';
    const secret = normalizeSecret(authenticatorForm.secret);

    if (!secret) {
      toast.error('Secret key is required.');
      return;
    }

    if (!isBase32Secret(secret)) {
      toast.error('Use a valid Base32 secret key.');
      return;
    }

    setAuthenticatorSaving(true);

    try {
      if (authenticatorTarget.account?.docId) {
        await updateDoc(doc(db, 'accounts', authenticatorTarget.account.docId), {
          issuer,
          name: accountName,
          secret,
          folderId: authenticatorTarget.password?.folderId || authenticatorTarget.account.folderId || null,
          vaultItemId: authenticatorTarget.password?.id || null,
        });
        toast.success('Authenticator updated.');
      } else {
        await addDoc(collection(db, 'accounts'), {
          id: createId(),
          issuer,
          name: accountName,
          secret,
          userId: user.uid,
          folderId: authenticatorTarget.password?.folderId || null,
          vaultItemId: authenticatorTarget.password?.id || null,
          createdAt: serverTimestamp(),
        });
        toast.success('Authenticator added to the account.');
      }

      resetAuthenticatorDialog();
    } catch (error) {
      console.error('Authenticator save failed', handleFirestoreError(error, authenticatorTarget.account ? OperationType.UPDATE : OperationType.CREATE, 'accounts'));
      toast.error(getFirestoreActionErrorMessage(error));
      setAuthenticatorSaving(false);
    }
  };

  const handleDeleteStandaloneAuthenticator = async (account: Account) => {
    if (!account.docId) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'accounts', account.docId));
      toast.success('Standalone authenticator removed.');
    } catch (error) {
      console.error('Authenticator delete failed', handleFirestoreError(error, OperationType.DELETE, 'accounts'));
      toast.error(getFirestoreActionErrorMessage(error));
    }
  };

  const handleAddFolder = async () => {
    if (!user) {
      return;
    }

    const name = newFolderName.trim();
    if (!name) {
      toast.error('Enter a folder name.');
      return;
    }

    try {
      await addDoc(collection(db, 'folders'), {
        id: createId(),
        name,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
      setNewFolderName('');
      setFolderDialogOpen(false);
      toast.success('Folder created.');
    } catch (error) {
      console.error('Folder create failed', handleFirestoreError(error, OperationType.CREATE, 'folders'));
      toast.error(getFirestoreActionErrorMessage(error));
    }
  };

  const handleDeleteFolder = async (folder: FolderType) => {
    if (!folder.docId) {
      return;
    }

    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'folders', folder.docId));

      for (const password of passwords) {
        if (password.folderId === folder.id && password.docId) {
          batch.update(doc(db, 'passwords', password.docId), { folderId: null });
        }
      }

      for (const account of accounts) {
        if (account.folderId === folder.id && account.docId) {
          batch.update(doc(db, 'accounts', account.docId), { folderId: null });
        }
      }

      await batch.commit();

      if (selectedFolderId === folder.id) {
        setSelectedFolderId('all');
      }

      toast.success('Folder deleted.');
    } catch (error) {
      console.error('Folder delete failed', handleFirestoreError(error, OperationType.WRITE, 'folders'));
      toast.error(getFirestoreActionErrorMessage(error));
    }
  };

  const handleExportVault = () => {
    const payload = {
      app: APP_NAME,
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: folders.map(({ id, name }) => ({ id, name })),
      passwords: passwords.map(({ id, title, accountName, username, password, url, notes, folderId }) => ({
        id,
        title,
        accountName: accountName || null,
        username,
        password,
        url: url || null,
        notes: notes || null,
        folderId: folderId || null,
      })),
      accounts: accounts.map(({ id, issuer, name, secret, folderId, vaultItemId }) => ({
        id,
        issuer,
        name,
        secret,
        folderId: folderId || null,
        vaultItemId: vaultItemId || null,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `auth-nest-vault-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Vault backup exported.');
  };

  const handleImportVault = async () => {
    if (!user || !importJson.trim()) {
      return;
    }

    try {
      const parsed = JSON.parse(importJson) as unknown;
      const batch = writeBatch(db);
      const folderIdMap = new Map<string, string>();
      const passwordIdMap = new Map<string, string>();
      let importedFolders = 0;
      let importedPasswords = 0;
      let importedAccounts = 0;

      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!entry || typeof entry !== 'object') {
            continue;
          }

          const candidate = entry as Partial<Account>;
          if (!candidate.issuer || !candidate.secret) {
            continue;
          }

          const accountRef = doc(collection(db, 'accounts'));
          batch.set(accountRef, {
            id: createId(),
            issuer: candidate.issuer,
            name: candidate.name || '',
            secret: normalizeSecret(candidate.secret),
            userId: user.uid,
            folderId: null,
            vaultItemId: null,
            createdAt: serverTimestamp(),
          });
          importedAccounts += 1;
        }
      } else if (parsed && typeof parsed === 'object') {
        const backup = parsed as {
          folders?: Array<Partial<FolderType>>;
          passwords?: Array<Partial<PasswordRecord>>;
          accounts?: Array<Partial<Account>>;
        };

        for (const entry of backup.folders || []) {
          if (!entry?.name) {
            continue;
          }

          const folderRef = doc(collection(db, 'folders'));
          const nextFolderId = createId();
          if (entry.id) {
            folderIdMap.set(entry.id, nextFolderId);
          }

          batch.set(folderRef, {
            id: nextFolderId,
            name: entry.name,
            userId: user.uid,
            createdAt: serverTimestamp(),
          });
          importedFolders += 1;
        }

        for (const entry of backup.passwords || []) {
          if (!entry?.title || !entry.username || !entry.password) {
            continue;
          }

          const passwordRef = doc(collection(db, 'passwords'));
          const nextPasswordId = createId();
          if (entry.id) {
            passwordIdMap.set(entry.id, nextPasswordId);
          }

          batch.set(passwordRef, {
            id: nextPasswordId,
            title: entry.title,
            accountName: entry.accountName || '',
            username: entry.username,
            password: entry.password,
            url: entry.url || null,
            notes: entry.notes || null,
            userId: user.uid,
            folderId: entry.folderId ? folderIdMap.get(entry.folderId) || null : null,
            createdAt: serverTimestamp(),
          });
          importedPasswords += 1;
        }

        for (const entry of backup.accounts || []) {
          if (!entry?.issuer || !entry.secret) {
            continue;
          }

          const accountRef = doc(collection(db, 'accounts'));
          batch.set(accountRef, {
            id: createId(),
            issuer: entry.issuer,
            name: entry.name || '',
            secret: normalizeSecret(entry.secret),
            userId: user.uid,
            folderId: entry.folderId ? folderIdMap.get(entry.folderId) || null : null,
            vaultItemId: entry.vaultItemId ? passwordIdMap.get(entry.vaultItemId) || null : null,
            createdAt: serverTimestamp(),
          });
          importedAccounts += 1;
        }
      } else {
        throw new Error('Invalid format');
      }

      await batch.commit();
      setImportDialogOpen(false);
      setImportJson('');

      if (!importedFolders && !importedPasswords && !importedAccounts) {
        toast.error('Nothing importable was found in that JSON payload.');
        return;
      }

      toast.success(`Imported ${importedPasswords} accounts, ${importedAccounts} authenticators, and ${importedFolders} folders.`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Import failed. Check the JSON format.');
    }
  };

  const handleSaveProfile = async () => {
    if (!auth.currentUser) {
      return;
    }

    const displayName = profileDisplayName.trim();
    if (!displayName) {
      toast.error('Display name is required.');
      return;
    }

    setProfileSubmitting(true);

    try {
      await updateProfile(auth.currentUser, {
        displayName,
        photoURL: profilePhotoDataUrl || null,
      });
      toast.success('Profile updated.');
    } catch (error) {
      console.error(error);
      toast.error(getFirebaseActionError(error));
    } finally {
      setProfileSubmitting(false);
    }
  };

  const handleProfilePhotoUpload = async (file?: File | null) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Upload an image file for your profile photo.');
      return;
    }

    try {
      const dataUrl = await resizeImageFileToDataUrl(file, 192);
      setProfilePhotoDataUrl(dataUrl);
      toast.success('Profile photo ready to save.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to process profile photo.');
    }
  };

  const handleSaveSecurity = async () => {
    if (!auth.currentUser) {
      return;
    }

    const nextEmail = securityEmail.trim();
    const wantsEmailChange = nextEmail && nextEmail !== (auth.currentUser.email || '');
    const wantsPasswordChange = securityPassword.length > 0;

    if (!wantsEmailChange && !wantsPasswordChange) {
      toast.error('Update your email or enter a new password first.');
      return;
    }

    if (wantsPasswordChange) {
      if (securityPassword.length < 6) {
        toast.error('Password must be at least 6 characters.');
        return;
      }

      if (securityPassword !== securityConfirmPassword) {
        toast.error('Passwords do not match.');
        return;
      }
    }

    setSecuritySubmitting(true);

    try {
      if (wantsEmailChange) {
        await updateEmail(auth.currentUser, nextEmail);
      }

      if (wantsPasswordChange) {
        await updatePassword(auth.currentUser, securityPassword);
      }

      setSecurityPassword('');
      setSecurityConfirmPassword('');
      toast.success('Security settings updated.');
    } catch (error) {
      console.error(error);
      toast.error(getFirebaseActionError(error));
    } finally {
      setSecuritySubmitting(false);
    }
  };

  const renderPageAction = () => {
    if (activePage === 'vault') {
      return (
        <Button className="rounded-2xl px-4" onClick={() => openCreateVaultDialog()}>
          <Plus className="mr-2 h-4 w-4" />
          Add New Account
        </Button>
      );
    }

    if (activePage === 'settings') {
      return (
        <Button variant="outline" className="rounded-2xl" onClick={() => setFolderDialogOpen(true)}>
          <FolderPlus className="mr-2 h-4 w-4" />
          New Folder
        </Button>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2.4, ease: 'linear' }}
            className="rounded-[2rem] bg-primary/10 p-5"
          >
            <BrandMark className="h-11 w-11" />
          </motion.div>
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-primary">Initializing</p>
            <p className="mt-2 text-sm text-muted-foreground">{APP_NAME} is preparing your vault.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background px-6 py-10 text-foreground">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.16),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(20,184,166,0.12),_transparent_34%)]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
        <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md flex-col items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-border/80 bg-card/80 px-4 py-2 shadow-lg shadow-black/10 backdrop-blur-xl">
              <BrandMark className="h-6 w-6" />
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{APP_NAME}</span>
            </div>
          </div>

          <Card className="w-full rounded-[2rem] border border-border/80 bg-card/95 p-6 shadow-2xl shadow-black/20 backdrop-blur-2xl sm:p-8">
            <div className="space-y-6">
              <div className="space-y-2 text-center">
                <h2 className="text-2xl font-semibold">Sign in to AuthNest</h2>
                <p className="text-sm text-muted-foreground">
                  Continue with your email and password or use Google to sync your vault across devices.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/70 p-1">
                <Button variant={authMode === 'signin' ? 'default' : 'ghost'} className="h-11 rounded-xl" onClick={() => setAuthMode('signin')}>
                  Sign In
                </Button>
                <Button variant={authMode === 'signup' ? 'default' : 'ghost'} className="h-11 rounded-xl" onClick={() => setAuthMode('signup')}>
                  Create Account
                </Button>
              </div>

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCredentialAuth();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="auth-email">Email</Label>
                  <Input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="h-12 rounded-2xl px-4"
                    disabled={authSubmitting}
                  />
                </div>

                <div className={`grid gap-4 ${authMode === 'signup' ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                  <div className="space-y-2">
                    <Label htmlFor="auth-password">Password</Label>
                    <Input
                      id="auth-password"
                      type="password"
                      autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      placeholder={authMode === 'signup' ? 'Create a password' : 'Enter your password'}
                      className="h-12 rounded-2xl px-4"
                      disabled={authSubmitting}
                    />
                  </div>

                  {authMode === 'signup' && (
                    <div className="space-y-2">
                      <Label htmlFor="auth-password-confirm">Confirm Password</Label>
                      <Input
                        id="auth-password-confirm"
                        type="password"
                        autoComplete="new-password"
                        value={authConfirmPassword}
                        onChange={(event) => setAuthConfirmPassword(event.target.value)}
                        placeholder="Confirm your password"
                        className="h-12 rounded-2xl px-4"
                        disabled={authSubmitting}
                      />
                    </div>
                  )}
                </div>

                <Button type="submit" className="h-12 w-full rounded-2xl" disabled={authSubmitting}>
                  {authSubmitting ? 'Working...' : authMode === 'signup' ? 'Create Auth Nest Account' : 'Sign In'}
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-3 tracking-[0.24em] text-muted-foreground">Or continue with</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="h-12 w-full rounded-2xl border-[#dadce0] bg-white font-[Roboto,Arial,sans-serif] font-medium text-[#3c4043] shadow-sm hover:bg-[#f8fafd] hover:text-[#202124] dark:border-[#dadce0] dark:bg-white dark:text-[#3c4043] dark:hover:bg-[#f8fafd] dark:hover:text-[#202124]"
                onClick={() => void handleGoogleLogin()}
                disabled={authSubmitting}
              >
                <svg aria-hidden="true" className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.37c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.37 12 5.37z" />
                </svg>
                Continue with Google
              </Button>

              <p className="text-xs leading-6 text-muted-foreground">
                By signing in you keep existing authentication, database sync, and vault data behavior intact while moving into the new Auth Nest workspace.
              </p>
            </div>
          </Card>
        </div>

        <Toaster />
      </div>
    );
  }

  const activeConfig = PAGE_CONFIG[activePage];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(29,78,216,0.08),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.08),_transparent_30%)]" />

      <Sidebar
        activePage={activePage}
        mobileOpen={mobileSidebarOpen}
        onNavigate={navigateToPage}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onOpenSettings={() => navigateToPage('settings')}
        onOpenHelp={() => navigateToPage('help')}
        user={user}
      />

      <div className="relative lg:pl-28">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" className="rounded-2xl lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="lg:hidden">
                <div className="flex items-center gap-3">
                  <BrandMark className="h-8 w-8" />
                  <div>
                    <p className="font-brand text-lg leading-none">{APP_NAME}</p>
                    <p className="text-xs text-muted-foreground">{activeConfig.label}</p>
                  </div>
                </div>
              </div>
              <div className="hidden lg:block">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">{APP_NAME}</p>
                <p className="text-sm text-muted-foreground">{activeConfig.label}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Button variant="outline" size="icon" className="rounded-2xl" onClick={toggleTheme}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="outline" className="hidden rounded-2xl sm:flex" onClick={() => navigateToPage('settings')}>
                <UserAvatar user={user} className="mr-2 h-6 w-6" />
                {user.displayName || 'Profile'}
              </Button>
              {renderPageAction()}
            </div>
          </div>
        </header>

        <main className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {activePage !== 'vault' && (
            <PageIntro
              icon={activeConfig.icon}
              title={activeConfig.title}
              description={activeConfig.description}
              breadcrumb={activeConfig.label}
            />
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activePage === 'vault' && (
                <div className="space-y-6">
                  <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-5 shadow-xl backdrop-blur-xl">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex flex-1 flex-col gap-4 md:flex-row">
                        <div className="relative flex-1">
                          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={vaultSearch}
                            onChange={(event) => setVaultSearch(event.target.value)}
                            placeholder="Search by platform, account name, username, URL, or remarks"
                            className="h-12 rounded-2xl border-border/80 bg-background/40 pl-11"
                          />
                        </div>
                        <select
                          value={selectedFolderId}
                          onChange={(event) => setSelectedFolderId(event.target.value as string | 'all')}
                          className="h-12 rounded-2xl border border-border/80 bg-background/40 px-4 text-sm outline-none"
                        >
                          <option value="all">All folders</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button variant="outline" className="rounded-2xl" onClick={() => setFolderDialogOpen(true)}>
                          <FolderPlus className="mr-2 h-4 w-4" />
                          Folder
                        </Button>
                        <Button className="rounded-2xl" onClick={() => openCreateVaultDialog()}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add New Account
                        </Button>
                      </div>
                    </div>
                  </Card>

                  {filteredVaultItems.length === 0 && orphanAccounts.length === 0 ? (
                    <PageEmptyState
                      title={vaultItems.length ? 'No accounts match this filter' : 'No accounts yet'}
                      description={
                        vaultItems.length
                          ? 'Adjust your search or folder filter to see more entries.'
                          : 'Add a new account to store credentials, create an authenticator key, or save both together.'
                      }
                      actionLabel={vaultItems.length ? 'Clear Filters' : 'Add New Account'}
                      onAction={() => {
                        if (vaultItems.length) {
                          setVaultSearch('');
                          setSelectedFolderId('all');
                          return;
                        }

                        openCreateVaultDialog();
                      }}
                    />
                  ) : (
                    <div className="space-y-6">
                      <div className="grid gap-4 xl:grid-cols-2">
                        <AnimatePresence mode="popLayout">
                          {filteredVaultItems.map((item) => (
                            <motion.div key={item.password.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
                              <VaultItemCard
                                item={item}
                                code={item.account ? codes[item.account.id] : ''}
                                remaining={remaining}
                                onCopyPassword={(value) => void copyToClipboard(value, 'Password copied.')}
                                onCopyUsername={(value) => void copyToClipboard(value, 'Username copied.')}
                                onCopyCode={(value) => void copyToClipboard(value, 'Authenticator code copied.')}
                                onEdit={() => openEditVaultDialog(item)}
                                onDelete={() => void handleDeleteVaultItem(item)}
                                onManageAuthenticator={() => openAuthenticatorDialog(item.password, item.account)}
                                onOpenLogin={() => openExternalUrl(item.password.url)}
                                onShowQr={() => {
                                  if (item.account) {
                                    setQrPreviewAccount(item.account);
                                  }
                                }}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>

                      {orphanAccounts.length > 0 && (
                        <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-6 shadow-xl backdrop-blur-xl">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <h2 className="text-lg font-semibold">Standalone Authenticators</h2>
                              <p className="text-sm text-muted-foreground">
                                These older authenticator records are still available inside Vault, but are not linked to a credential yet.
                              </p>
                            </div>
                          </div>

                          <div className="mt-5 grid gap-4 xl:grid-cols-2">
                            {orphanAccounts.map((account) => (
                              <StandaloneAuthenticatorCard
                                key={account.id}
                                account={account}
                                folder={account.folderId ? folderMap.get(account.folderId) : undefined}
                                code={codes[account.id]}
                                remaining={remaining}
                                onCopyCode={(value) => void copyToClipboard(value, 'Authenticator code copied.')}
                                onManage={() => openAuthenticatorDialog(null, account)}
                                onCreateVaultItem={() =>
                                  openCreateVaultDialog(
                                    {
                                      platform: account.issuer,
                                      username: account.name,
                                    },
                                    account,
                                  )
                                }
                                onDelete={() => void handleDeleteStandaloneAuthenticator(account)}
                                onShowQr={() => setQrPreviewAccount(account)}
                              />
                            ))}
                          </div>
                        </Card>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activePage === 'settings' && (
                <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
                  <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-4 shadow-xl backdrop-blur-xl">
                    <div className="space-y-2">
                      {SETTINGS_SECTIONS.map((section) => {
                        const Icon = section.icon;
                        return (
                          <Button
                            key={section.id}
                            variant={settingsSection === section.id ? 'secondary' : 'ghost'}
                            className="h-11 w-full justify-start rounded-2xl"
                            onClick={() => setSettingsSection(section.id)}
                          >
                            <Icon className="mr-2 h-4 w-4" />
                            {section.label}
                          </Button>
                        );
                      })}
                    </div>
                  </Card>

                  <div className="space-y-6">
                    {settingsSection === 'profile' && (
                      <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-6 shadow-xl backdrop-blur-xl">
                        <div className="space-y-6">
                          <div>
                            <h2 className="text-lg font-semibold">Profile</h2>
                            <p className="text-sm text-muted-foreground">Update the name and avatar shown around Auth Nest.</p>
                          </div>

                          <div className="flex items-center gap-4 rounded-[1.6rem] border border-border/60 bg-background/40 p-4">
                            <UserAvatar user={user} className="h-16 w-16" preview={profilePhotoDataUrl} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{profileDisplayName || 'Auth Nest user'}</p>
                              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                            </div>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2 sm:col-span-2">
                              <Label>Display Name</Label>
                              <Input value={profileDisplayName} onChange={(event) => setProfileDisplayName(event.target.value)} className="h-12 rounded-2xl px-4" />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                              <Label>Profile Picture</Label>
                              <label className="flex cursor-pointer items-center gap-4 rounded-[1.6rem] border border-dashed border-border bg-background/40 p-4 transition-colors hover:bg-background/60">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background">
                                  {profilePhotoDataUrl ? (
                                    <img src={profilePhotoDataUrl} alt="Profile preview" className="h-12 w-12 rounded-xl object-cover" />
                                  ) : (
                                    <User className="h-5 w-5 text-muted-foreground" />
                                  )}
                                </div>
                                <div>
                                  <p className="font-medium">Upload a profile image</p>
                                  <p className="text-xs text-muted-foreground">PNG, JPG, SVG, or WebP. It will be resized before saving.</p>
                                </div>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(event) => {
                                    void handleProfilePhotoUpload(event.target.files?.[0]);
                                    event.target.value = '';
                                  }}
                                />
                              </label>
                            </div>
                          </div>

                          <Button className="rounded-2xl" onClick={() => void handleSaveProfile()} disabled={profileSubmitting}>
                            {profileSubmitting ? 'Saving...' : 'Save Profile'}
                          </Button>
                        </div>
                      </Card>
                    )}

                    {settingsSection === 'security' && (
                      <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-6 shadow-xl backdrop-blur-xl">
                        <div className="space-y-6">
                          <div>
                            <h2 className="text-lg font-semibold">Security</h2>
                            <p className="text-sm text-muted-foreground">Change your sign-in email or password without touching vault data.</p>
                          </div>

                          <div className="grid gap-4">
                            <div className="space-y-2">
                              <Label>Email Address</Label>
                              <Input value={securityEmail} onChange={(event) => setSecurityEmail(event.target.value)} className="h-12 rounded-2xl px-4" />
                            </div>
                            <div className="space-y-2">
                              <Label>New Password</Label>
                              <Input type="password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} className="h-12 rounded-2xl px-4" />
                            </div>
                            <div className="space-y-2">
                              <Label>Confirm New Password</Label>
                              <Input type="password" value={securityConfirmPassword} onChange={(event) => setSecurityConfirmPassword(event.target.value)} className="h-12 rounded-2xl px-4" />
                            </div>
                          </div>

                          <p className="text-sm text-muted-foreground">
                            Sensitive Firebase updates may require a recent sign-in. If the change is blocked, sign out and back in first.
                          </p>

                          <div className="flex flex-wrap gap-3">
                            <Button className="rounded-2xl" onClick={() => void handleSaveSecurity()} disabled={securitySubmitting}>
                              {securitySubmitting ? 'Saving...' : 'Save Security Changes'}
                            </Button>
                            <Button variant="outline" className="rounded-2xl border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setSignOutDialogOpen(true)}>
                              <LogOut className="mr-2 h-4 w-4" />
                              Sign Out
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )}

                    {settingsSection === 'vault' && (
                      <div className="space-y-6">
                        <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-6 shadow-xl backdrop-blur-xl">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <h2 className="text-lg font-semibold">Folders</h2>
                              <p className="text-sm text-muted-foreground">Organize accounts by workspace, team, or account type.</p>
                            </div>
                            <Button className="rounded-2xl" onClick={() => setFolderDialogOpen(true)}>
                              <FolderPlus className="mr-2 h-4 w-4" />
                              New Folder
                            </Button>
                          </div>

                          <div className="mt-5 space-y-3">
                            {folders.length === 0 ? (
                              <PageEmptyState title="No folders yet" description="Create a folder to organize your vault." actionLabel="Create Folder" onAction={() => setFolderDialogOpen(true)} compact />
                            ) : (
                              folders.map((folder) => (
                                <div key={folder.id} className="flex items-center justify-between gap-4 rounded-[1.6rem] border border-border/60 bg-background/40 px-4 py-4">
                                  <div>
                                    <p className="font-medium">{folder.name}</p>
                                    <p className="text-sm text-muted-foreground">
                                      {vaultItems.filter((item) => item.password.folderId === folder.id).length} account(s)
                                    </p>
                                  </div>
                                  <Button variant="outline" className="rounded-2xl border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => void handleDeleteFolder(folder)}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </Button>
                                </div>
                              ))
                            )}
                          </div>
                        </Card>

                        <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-6 shadow-xl backdrop-blur-xl">
                          <div className="space-y-5">
                            <div>
                              <h2 className="text-lg font-semibold">Backups</h2>
                              <p className="text-sm text-muted-foreground">Export your current vault or import a previous backup.</p>
                            </div>

                            <div className="flex flex-wrap gap-3">
                              <Button variant="outline" className="rounded-2xl" onClick={handleExportVault}>
                                <Download className="mr-2 h-4 w-4" />
                                Export Backup
                              </Button>
                              <Button variant="outline" className="rounded-2xl" onClick={() => setImportDialogOpen(true)}>
                                <Upload className="mr-2 h-4 w-4" />
                                Import Backup
                              </Button>
                            </div>
                          </div>
                        </Card>
                      </div>
                    )}

                    {settingsSection === 'appearance' && (
                      <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-6 shadow-xl backdrop-blur-xl">
                        <div className="space-y-6">
                          <div>
                            <h2 className="text-lg font-semibold">Appearance</h2>
                            <p className="text-sm text-muted-foreground">Stay close to the existing design system while keeping the interface cleaner and more consistent.</p>
                          </div>

                          <div className="flex items-center justify-between rounded-[1.6rem] border border-border/60 bg-background/40 px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                                {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                              </div>
                              <div>
                                <p className="font-medium">Theme Mode</p>
                                <p className="text-sm text-muted-foreground">Switch between light and dark themes.</p>
                              </div>
                            </div>
                            <Button variant="outline" className="rounded-2xl" onClick={toggleTheme}>
                              {theme === 'dark' ? 'Use Light Theme' : 'Use Dark Theme'}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )}
                  </div>
                </div>
              )}

              {activePage === 'help' && (
                <div className="grid gap-6 md:grid-cols-2">
                  <HelpCard
                    icon={Info}
                    title="Getting Started"
                    description="Use Add New Account from Vault, then save credentials, create an authenticator key, or link both to the same account."
                    actionLabel="Open Vault"
                    onAction={() => navigateToPage('vault')}
                  />
                  <HelpCard
                    icon={KeyRound}
                    title="Vault Help"
                    description="Use folders to organize entries, search by platform or username, and review the dashboard for weak password warnings."
                    actionLabel="Open Settings"
                    onAction={() => navigateToPage('settings')}
                  />
                  <HelpCard
                    icon={QrCode}
                    title="Authenticator Setup"
                    description="Open any saved account and choose Add Authenticator. You can paste a secret key, scan from the camera, or upload a QR image."
                    actionLabel="Review Vault"
                    onAction={() => navigateToPage('vault')}
                  />
                  <HelpCard
                    icon={LifeBuoy}
                    title="Contact Support"
                    description="Use your deployment’s support channel or workspace admin contact for account recovery, policy questions, or backend support."
                    actionLabel="View Security Settings"
                    onAction={() => {
                      setSettingsSection('security');
                      navigateToPage('settings');
                    }}
                  />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <Dialog open={vaultDialogOpen} onOpenChange={(open) => (open ? setVaultDialogOpen(true) : resetVaultDialog())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[2rem] border border-border/70 bg-background/95 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-2xl">
          <DialogHeader className="border-b border-border/70 px-6 py-6">
            <DialogTitle className="text-xl">{editingVaultItem ? 'Edit Account' : 'Add New Account'}</DialogTitle>
            <DialogDescription>
              Choose whether this account needs saved credentials, an authenticator key, or both linked together.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 px-6 py-6">
            {!editingVaultItem && !pendingLinkAccountId && (
              <div className="space-y-3">
                <Label>What do you want to save?</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    { value: 'credentials', label: 'Save Credentials' },
                    { value: 'authenticator', label: 'Create Authenticator Key' },
                    { value: 'both', label: 'Both Same Account' },
                  ].map((option) => (
                    <Button
                      key={option.value}
                      variant={vaultForm.entryType === option.value ? 'default' : 'outline'}
                      className="h-auto min-h-12 rounded-2xl whitespace-normal"
                      onClick={() => setVaultForm((current) => ({ ...current, entryType: option.value as VaultEntryType }))}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {(editingVaultItem || pendingLinkAccountId || vaultForm.entryType !== 'authenticator') && (
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Input
                    value={vaultForm.platform}
                    onChange={(event) => setVaultForm((current) => ({ ...current, platform: event.target.value }))}
                    placeholder="Google, GitHub, Banking"
                    className="h-12 rounded-2xl px-4"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email / Username</Label>
                  <Input
                    value={vaultForm.username}
                    onChange={(event) => setVaultForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="you@example.com"
                    className="h-12 rounded-2xl px-4"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={vaultForm.password}
                    onChange={(event) => setVaultForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="Store the account password"
                    className="h-12 rounded-2xl px-4"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Login URL (Optional)</Label>
                  <Input
                    value={vaultForm.loginUrl}
                    onChange={(event) => setVaultForm((current) => ({ ...current, loginUrl: event.target.value }))}
                    placeholder="https://example.com/login"
                    className="h-12 rounded-2xl px-4"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Folder Selection</Label>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <select
                      value={vaultForm.folderId}
                      onChange={(event) => setVaultForm((current) => ({ ...current, folderId: event.target.value }))}
                      className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none"
                    >
                      <option value="">No folder</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                    <Button variant="outline" className="h-12 rounded-2xl" onClick={() => setFolderDialogOpen(true)}>
                      <FolderPlus className="mr-2 h-4 w-4" />
                      Create New Folder
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {!editingVaultItem && !pendingLinkAccountId && vaultForm.entryType === 'authenticator' && (
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Issuer Name</Label>
                  <Input
                    value={vaultForm.totpIssuer}
                    onChange={(event) => setVaultForm((current) => ({ ...current, totpIssuer: event.target.value }))}
                    placeholder="Google, GitHub, Banking"
                    className="h-12 rounded-2xl px-4"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Username/Email</Label>
                  <Input
                    value={vaultForm.totpUsername}
                    onChange={(event) => setVaultForm((current) => ({ ...current, totpUsername: event.target.value }))}
                    placeholder="you@example.com"
                    className="h-12 rounded-2xl px-4"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Folder Selection</Label>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <select
                      value={vaultForm.folderId}
                      onChange={(event) => setVaultForm((current) => ({ ...current, folderId: event.target.value }))}
                      className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none"
                    >
                      <option value="">No folder</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                    <Button variant="outline" className="h-12 rounded-2xl" onClick={() => setFolderDialogOpen(true)}>
                      <FolderPlus className="mr-2 h-4 w-4" />
                      Create New Folder
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {!editingVaultItem && !pendingLinkAccountId && (vaultForm.entryType === 'authenticator' || vaultForm.entryType === 'both') && (
              <div className="space-y-5 rounded-[1.6rem] border border-border/70 bg-background/40 p-4">
                <div>
                  <h3 className="font-medium">Authenticator Key</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {vaultForm.entryType === 'both'
                      ? 'Use the same platform and username above, then add the TOTP key by QR or Secret Key.'
                      : 'Create the TOTP key by scanning a QR code or entering the Secret Key manually.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/70 p-1">
                  <Button
                    variant={vaultForm.totpMethod === 'scan' ? 'default' : 'ghost'}
                    className="h-11 rounded-xl"
                    onClick={() => setVaultForm((current) => ({ ...current, totpMethod: 'scan' }))}
                  >
                    Scan QR
                  </Button>
                  <Button
                    variant={vaultForm.totpMethod === 'secret' ? 'default' : 'ghost'}
                    className="h-11 rounded-xl"
                    onClick={() => setVaultForm((current) => ({ ...current, totpMethod: 'secret' }))}
                  >
                    Enter Manually
                  </Button>
                </div>

                {vaultForm.totpMethod === 'secret' ? (
                  <div className="space-y-2">
                    <Label>Secret Key</Label>
                    <Input
                      value={vaultForm.totpSecret}
                      onChange={(event) => setVaultForm((current) => ({ ...current, totpSecret: event.target.value }))}
                      placeholder="Paste the Base32 secret key"
                      className="h-12 rounded-2xl px-4 font-mono"
                    />
                  </div>
                ) : (
                  <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
                    <div className="space-y-3">
                      <div className="rounded-[1.6rem] border border-border/70 bg-background/40 p-4">
                        <p className="mb-3 text-sm font-medium">Live camera scan</p>
                        <QRScanner
                          onScanSuccess={(decodedText) => {
                            applyDecodedAuthenticatorValue(decodedText, 'vault');
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-[1.6rem] border border-border/70 bg-background/40 p-4">
                        <p className="text-sm font-medium">Upload QR Image</p>
                        <p className="mt-2 text-sm text-muted-foreground">Use a screenshot or exported QR image if camera scanning is not practical.</p>
                        <label className="mt-4 flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border px-4 py-4 text-sm transition-colors hover:bg-background/60">
                          <ScanLine className="mr-2 h-4 w-4" />
                          {scanningQrFile ? 'Reading image...' : 'Choose Image'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              void handleQrFileUpload(event.target.files?.[0], 'vault');
                              event.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                      {vaultForm.totpSecret && (
                        <div className="rounded-[1.4rem] border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
                          QR code captured. You can save this account now.
                        </div>
                      )}
                      <div id="authenticator-file-reader" className="hidden" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-border/70 bg-background/60 px-6 py-4">
            <Button variant="outline" className="rounded-2xl" onClick={resetVaultDialog}>
              Cancel
            </Button>
            <Button className="rounded-2xl" onClick={() => void handleSaveVaultItem()}>
              {editingVaultItem ? 'Save Changes' : vaultForm.entryType === 'authenticator' ? 'Create Authenticator Key' : 'Save Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={authenticatorDialogOpen} onOpenChange={(open) => (open ? setAuthenticatorDialogOpen(true) : resetAuthenticatorDialog())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[2rem] border border-border/70 bg-background/95 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-2xl">
          <DialogHeader className="border-b border-border/70 px-6 py-6">
            <DialogTitle className="text-xl">
              {authenticatorTarget?.password
                ? authenticatorTarget.account
                  ? 'Manage Authenticator'
                  : 'Add Authenticator'
                : 'Edit Standalone Authenticator'}
            </DialogTitle>
            <DialogDescription>
              Attach a secret key directly to this account, or scan a QR code to capture the authenticator details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 px-6 py-6">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/70 p-1">
              <Button
                variant={authenticatorMethod === 'secret' ? 'default' : 'ghost'}
                className="h-11 rounded-xl"
                onClick={() => setAuthenticatorMethod('secret')}
              >
                Secret Key
              </Button>
              <Button
                variant={authenticatorMethod === 'scan' ? 'default' : 'ghost'}
                className="h-11 rounded-xl"
                onClick={() => setAuthenticatorMethod('scan')}
              >
                Scan QR Code
              </Button>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Issuer</Label>
                <Input
                  value={authenticatorForm.issuer}
                  onChange={(event) => setAuthenticatorForm((current) => ({ ...current, issuer: event.target.value }))}
                  placeholder="Platform or issuer"
                  className="h-12 rounded-2xl px-4"
                />
              </div>
              <div className="space-y-2">
                <Label>Account Name</Label>
                <Input
                  value={authenticatorForm.accountName}
                  onChange={(event) => setAuthenticatorForm((current) => ({ ...current, accountName: event.target.value }))}
                  placeholder="Email or profile name"
                  className="h-12 rounded-2xl px-4"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Secret Key</Label>
                <Input
                  value={authenticatorForm.secret}
                  onChange={(event) => setAuthenticatorForm((current) => ({ ...current, secret: event.target.value }))}
                  placeholder="Paste the Base32 secret key"
                  className="h-12 rounded-2xl px-4 font-mono"
                />
              </div>
            </div>

            {authenticatorMethod === 'scan' && (
              <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
                <div className="space-y-3">
                  <div className="rounded-[1.6rem] border border-border/70 bg-background/40 p-4">
                    <p className="mb-3 text-sm font-medium">Live camera scan</p>
                    <QRScanner
                      onScanSuccess={(decodedText) => {
                        applyDecodedAuthenticatorValue(decodedText);
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-[1.6rem] border border-border/70 bg-background/40 p-4">
                    <p className="text-sm font-medium">Upload QR Image</p>
                    <p className="mt-2 text-sm text-muted-foreground">Use a screenshot or exported QR image if camera scanning is not practical.</p>
                    <label className="mt-4 flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border px-4 py-4 text-sm transition-colors hover:bg-background/60">
                      <ScanLine className="mr-2 h-4 w-4" />
                      {scanningQrFile ? 'Reading image...' : 'Choose Image'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          void handleQrFileUpload(event.target.files?.[0]);
                          event.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  <div id="authenticator-file-reader" className="hidden" />
                </div>
              </div>
            )}

            {!authenticatorTarget?.password && (
              <div className="rounded-[1.6rem] border border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                This authenticator is currently standalone. Add credentials from the Vault page if you want to link it to a saved account.
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-border/70 bg-background/60 px-6 py-4">
            <Button variant="outline" className="rounded-2xl" onClick={resetAuthenticatorDialog}>
              Cancel
            </Button>
            <Button className="rounded-2xl" onClick={() => void handleSaveAuthenticator()} disabled={authenticatorSaving}>
              {authenticatorSaving ? 'Saving...' : authenticatorTarget?.account ? 'Save Authenticator' : 'Add Authenticator'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="rounded-[2rem] border border-border/70 bg-background/95 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-md">
          <DialogHeader className="border-b border-border/70 px-6 py-6">
            <DialogTitle className="text-xl">New Folder</DialogTitle>
            <DialogDescription>Create a folder for vault organization.</DialogDescription>
          </DialogHeader>
          <div className="px-6 py-6">
            <div className="space-y-2">
              <Label>Folder Name</Label>
              <Input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} className="h-12 rounded-2xl px-4" placeholder="Work, Personal, Shared" />
            </div>
          </div>
          <DialogFooter className="border-t border-border/70 bg-background/60 px-6 py-4">
            <Button variant="outline" className="rounded-2xl" onClick={() => setFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-2xl" onClick={() => void handleAddFolder()}>
              Create Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[2rem] border border-border/70 bg-background/95 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-2xl">
          <DialogHeader className="border-b border-border/70 px-6 py-6">
            <DialogTitle className="text-xl">Import Vault Backup</DialogTitle>
            <DialogDescription>
              Paste a full Auth Nest vault backup or a legacy authenticator export array.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-6">
            <textarea
              value={importJson}
              onChange={(event) => setImportJson(event.target.value)}
              className="min-h-[300px] w-full rounded-[1.6rem] border border-border bg-transparent px-4 py-4 font-mono text-xs outline-none"
              placeholder='{"passwords":[...],"accounts":[...],"folders":[...]}'
            />
          </div>
          <DialogFooter className="border-t border-border/70 bg-background/60 px-6 py-4">
            <Button variant="outline" className="rounded-2xl" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-2xl" onClick={() => void handleImportVault()}>
              Import Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(qrPreviewAccount)} onOpenChange={(open) => !open && setQrPreviewAccount(null)}>
        <DialogContent className="rounded-[2rem] border border-border/70 bg-background/95 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-md">
          <DialogHeader className="border-b border-border/70 px-6 py-6">
            <DialogTitle className="text-xl">Authenticator QR Code</DialogTitle>
            <DialogDescription>
              Reuse this QR code in another trusted authenticator app if you need to restore the linked secret.
            </DialogDescription>
          </DialogHeader>

          {qrPreviewAccount && (
            <div className="space-y-5 px-6 py-6">
              <div className="flex items-center gap-3">
                <PlatformBadge label={qrPreviewAccount.issuer} hint={qrPreviewAccount.name} />
                <div>
                  <p className="font-medium">{qrPreviewAccount.issuer}</p>
                  <p className="text-sm text-muted-foreground">{qrPreviewAccount.name || 'Authenticator secret'}</p>
                </div>
              </div>

              <div className="flex justify-center rounded-[1.8rem] border border-border/70 bg-white p-5">
                <QRCodeSVG value={buildOtpauthUri({ issuer: qrPreviewAccount.issuer, accountName: qrPreviewAccount.name || 'Account', secret: qrPreviewAccount.secret })} size={220} />
              </div>
            </div>
          )}

          <DialogFooter className="border-t border-border/70 bg-background/60 px-6 py-4">
            <Button variant="outline" className="rounded-2xl" onClick={() => setQrPreviewAccount(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={signOutDialogOpen} onOpenChange={setSignOutDialogOpen}>
        <DialogContent className="rounded-[2rem] border border-border/70 bg-background/95 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-md">
          <DialogHeader className="border-b border-border/70 px-6 py-6">
            <DialogTitle className="text-xl">Sign out of {APP_NAME}?</DialogTitle>
            <DialogDescription>You will need to sign in again before you can access the vault.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t border-border/70 bg-background/60 px-6 py-4">
            <Button variant="outline" className="rounded-2xl" onClick={() => setSignOutDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" className="rounded-2xl" onClick={() => void handleLogout()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  );
}

const Sidebar: React.FC<{
  activePage: AppPage;
  mobileOpen: boolean;
  onNavigate: (page: AppPage) => void;
  onCloseMobile: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  user: FirebaseUser;
}> = ({ activePage, mobileOpen, onNavigate, onCloseMobile, onOpenSettings, onOpenHelp, user }) => {
  const primaryPages: AppPage[] = ['vault', 'settings'];

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-28 border-r border-border/70 bg-background/75 px-3 py-5 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex items-center justify-center">
          <BrandMark className="h-11 w-11" />
        </div>

        <nav className="mt-8 space-y-2">
          {primaryPages.map((page) => (
            <SidebarButton key={page} page={page} active={activePage === page} onClick={() => onNavigate(page)} />
          ))}
        </nav>

        <div className="mt-auto space-y-2">
          <Button variant={activePage === 'help' ? 'secondary' : 'ghost'} className="h-auto w-full flex-col gap-2 rounded-2xl px-3 py-3" onClick={onOpenHelp}>
            <LifeBuoy className="h-5 w-5" />
            <span className="text-xs">Help</span>
          </Button>
          <div className="rounded-2xl border border-border/70 bg-background/50 px-3 py-3 text-center">
            <UserAvatar user={user} className="mx-auto h-10 w-10" />
            <p className="mt-2 truncate text-xs font-medium">{user.displayName || 'Profile'}</p>
          </div>
        </div>
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 lg:hidden">
            <button className="absolute inset-0 bg-black/45" onClick={onCloseMobile} aria-label="Close navigation" />
            <motion.aside
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              className="relative h-full w-[290px] border-r border-border/70 bg-background px-5 py-5 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <BrandMark className="h-10 w-10" />
                  <div>
                    <p className="font-brand text-lg">{APP_NAME}</p>
                    <p className="text-xs text-muted-foreground">Vault-first security</p>
                  </div>
                </div>
                <Button variant="outline" size="icon" className="rounded-2xl" onClick={onCloseMobile}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-8 space-y-2">
                {primaryPages.map((page) => (
                  <Button
                    key={page}
                    variant={activePage === page ? 'secondary' : 'ghost'}
                    className="h-12 w-full justify-start rounded-2xl"
                    onClick={() => onNavigate(page)}
                  >
                    {React.createElement(PAGE_CONFIG[page].icon, { className: 'mr-2 h-4 w-4' })}
                    {PAGE_CONFIG[page].label}
                  </Button>
                ))}
              </div>

              <div className="mt-auto space-y-3 pt-8">
                <Button variant={activePage === 'help' ? 'secondary' : 'ghost'} className="h-12 w-full justify-start rounded-2xl" onClick={onOpenHelp}>
                  <LifeBuoy className="mr-2 h-4 w-4" />
                  Help and Support
                </Button>
                <Button variant="ghost" className="h-12 w-full justify-start rounded-2xl" onClick={onOpenSettings}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  Settings
                </Button>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

const SidebarButton: React.FC<{
  page: AppPage;
  active: boolean;
  onClick: () => void;
}> = ({ page, active, onClick }) => {
  const config = PAGE_CONFIG[page];
  const Icon = config.icon;

  return (
    <Button variant={active ? 'secondary' : 'ghost'} className="h-auto w-full flex-col gap-2 rounded-2xl px-3 py-3" onClick={onClick}>
      <Icon className="h-5 w-5" />
      <span className="text-xs">{config.label}</span>
    </Button>
  );
};

const PageIntro: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  breadcrumb: string;
}> = ({ icon: Icon, title, description, breadcrumb }) => {
  return (
    <Card className="mb-6 rounded-[2rem] border border-border/70 bg-background/75 p-6 shadow-xl backdrop-blur-xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-[1.4rem] bg-primary/10 p-4 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">{breadcrumb}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>
    </Card>
  );
};

const VaultItemCard: React.FC<{
  item: VaultItem;
  code?: string;
  remaining: number;
  onCopyPassword: (value: string) => void;
  onCopyUsername: (value: string) => void;
  onCopyCode: (value: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onManageAuthenticator: () => void;
  onOpenLogin: () => void;
  onShowQr: () => void;
}> = ({ item, code, remaining, onCopyPassword, onCopyUsername, onCopyCode, onEdit, onDelete, onManageAuthenticator, onOpenLogin, onShowQr }) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-5 shadow-xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformBadge
            label={item.account?.issuer || item.password.title}
            hint={`${item.password.title} ${item.password.url || ''}`}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold">{item.password.title}</h3>
              <PasswordStrengthBadge strength={item.strength} compact />
              {item.folder && <FolderPill folder={item.folder.name} />}
            </div>
            <p className="truncate text-sm text-muted-foreground">{item.password.accountName || item.password.username}</p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="rounded-2xl">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Edit3 className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            {item.password.url && (
              <DropdownMenuItem onClick={onOpenLogin}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Login URL
              </DropdownMenuItem>
            )}
            {item.account && (
              <DropdownMenuItem onClick={onShowQr}>
                <QrCode className="mr-2 h-4 w-4" />
                Show QR Code
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5 grid gap-3">
        <InfoRow
          label="Email / Username"
          value={item.password.username}
          actionIcon={Copy}
          actionLabel="Copy username"
          onAction={() => onCopyUsername(item.password.username)}
        />
        <InfoRow
          label="Password"
          value={showPassword ? item.password.password : '••••••••••••••••'}
          mono
          actionIcon={showPassword ? Lock : Globe}
          actionLabel={showPassword ? 'Hide password' : 'Show password'}
          onAction={() => setShowPassword((current) => !current)}
          secondaryActionIcon={Copy}
          secondaryActionLabel="Copy password"
          onSecondaryAction={() => onCopyPassword(item.password.password)}
        />
        <InfoRow
          label="Login URL"
          value={item.password.url || 'Not provided'}
          actionIcon={item.password.url ? ExternalLink : Link2}
          actionLabel={item.password.url ? 'Open URL' : 'No URL'}
          onAction={item.password.url ? onOpenLogin : undefined}
        />
        {item.password.notes && (
          <div className="rounded-[1.4rem] border border-border/60 bg-background/40 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Additional Remarks</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.password.notes}</p>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-[1.6rem] border border-border/70 bg-background/40 p-4">
        {item.account && code ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Authenticator Enabled</p>
                <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.18em]">{`${code.slice(0, 3)} ${code.slice(3)}`}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{remaining}s left</p>
                <div className="mt-2 h-2 w-28 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${remaining <= 5 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${(remaining / 30) * 100}%` }} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button className="rounded-2xl" onClick={() => onCopyCode(code)}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Code
              </Button>
              <Button variant="outline" className="rounded-2xl" onClick={onManageAuthenticator}>
                <Settings2 className="mr-2 h-4 w-4" />
                Manage Authenticator
              </Button>
              <Button variant="outline" className="rounded-2xl" onClick={onShowQr}>
                <QrCode className="mr-2 h-4 w-4" />
                Show QR
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Authenticator not added yet</p>
              <p className="text-sm text-muted-foreground">Attach a TOTP secret to this same account using a secret key or QR code.</p>
            </div>
            <Button className="rounded-2xl" onClick={onManageAuthenticator}>
              <Plus className="mr-2 h-4 w-4" />
              Add Authenticator
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};

const StandaloneAuthenticatorCard: React.FC<{
  account: Account;
  folder: FolderType | undefined;
  code?: string;
  remaining: number;
  onCopyCode: (value: string) => void;
  onManage: () => void;
  onCreateVaultItem: () => void;
  onDelete: () => void;
  onShowQr: () => void;
}> = ({ account, folder, code, remaining, onCopyCode, onManage, onCreateVaultItem, onDelete, onShowQr }) => {
  return (
    <Card className="rounded-[1.8rem] border border-border/70 bg-background/60 p-5 shadow-lg backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformBadge label={account.issuer} hint={account.name} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold">{account.issuer}</h3>
              {folder && <FolderPill folder={folder.name} />}
            </div>
            <p className="truncate text-sm text-muted-foreground">{account.name || 'Standalone authenticator'}</p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="rounded-2xl">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onManage}>
              <Edit3 className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onShowQr}>
              <QrCode className="mr-2 h-4 w-4" />
              Show QR Code
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5 rounded-[1.5rem] border border-border/60 bg-background/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Current TOTP</p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.18em]">{code ? `${code.slice(0, 3)} ${code.slice(3)}` : '••• •••'}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{remaining}s left</p>
            <div className="mt-2 h-2 w-24 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${remaining <= 5 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${(remaining / 30) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button className="rounded-2xl" onClick={() => code && onCopyCode(code)}>
          <Copy className="mr-2 h-4 w-4" />
          Copy Code
        </Button>
        <Button variant="outline" className="rounded-2xl" onClick={onCreateVaultItem}>
          <Plus className="mr-2 h-4 w-4" />
          Add Credentials
        </Button>
      </div>
    </Card>
  );
};

const HelpCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}> = ({ icon: Icon, title, description, actionLabel, onAction }) => {
  return (
    <Card className="rounded-[2rem] border border-border/70 bg-background/75 p-6 shadow-xl backdrop-blur-xl">
      <div className="flex items-start gap-4">
        <div className="rounded-[1.4rem] bg-primary/10 p-4 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
          <Button variant="outline" className="rounded-2xl" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
};

const PageEmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  compact?: boolean;
}> = ({ title, description, actionLabel, onAction, compact = false }) => {
  return (
    <Card className={`rounded-[2rem] border border-dashed border-border/80 bg-background/60 px-6 py-8 text-center shadow-lg backdrop-blur-xl ${compact ? '' : 'min-h-[260px] justify-center'}`}>
      <div className="mx-auto max-w-md space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Info className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <Button className="rounded-2xl" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </Card>
  );
};

const PlatformBadge: React.FC<{
  label: string;
  hint?: string | null;
}> = ({ label, hint }) => {
  const service = findServiceIcon(`${label} ${hint || ''}`);
  const hue = buildSeedHue(label || APP_NAME);
  const background = `linear-gradient(135deg, hsla(${hue}, 78%, 56%, 0.26), hsla(${(hue + 34) % 360}, 84%, 62%, 0.42))`;

  if (service) {
    return (
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[1.4rem] border border-border/70 bg-white p-2 shadow-lg"
        title={service.name}
        aria-label={`${service.name} service`}
      >
        <img src={service.icon} alt="" className="h-full w-full object-contain" />
      </div>
    );
  }

  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.4rem] border border-white/15 text-sm font-semibold text-white shadow-lg"
      style={{ background }}
      title={label}
    >
      {buildInitials(label)}
    </div>
  );
};

const FolderPill: React.FC<{
  folder: string;
}> = ({ folder }) => {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/50 px-2.5 py-1 text-xs text-muted-foreground">
      <Folder className="h-3 w-3" />
      {folder}
    </span>
  );
};

const PasswordStrengthBadge: React.FC<{
  strength: PasswordStrength;
  compact?: boolean;
}> = ({ strength, compact = false }) => {
  const classes =
    strength.label === 'Excellent'
      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500'
      : strength.label === 'Strong'
        ? 'border-sky-500/35 bg-sky-500/10 text-sky-500'
        : strength.label === 'Fair'
          ? 'border-amber-500/35 bg-amber-500/10 text-amber-500'
          : 'border-rose-500/35 bg-rose-500/10 text-rose-500';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${classes} ${compact ? '' : ''}`}>
      {strength.label}
    </span>
  );
};

const InfoRow: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  actionIcon: React.ComponentType<{ className?: string }>;
  actionLabel: string;
  onAction?: () => void;
  secondaryActionIcon?: React.ComponentType<{ className?: string }>;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}> = ({ label, value, mono = false, actionIcon: ActionIcon, actionLabel, onAction, secondaryActionIcon: SecondaryActionIcon, secondaryActionLabel, onSecondaryAction }) => {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[1.4rem] border border-border/60 bg-background/40 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className={`mt-2 truncate text-sm ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onSecondaryAction && SecondaryActionIcon && secondaryActionLabel && (
          <Button variant="ghost" size="icon" className="rounded-2xl" onClick={onSecondaryAction} aria-label={secondaryActionLabel}>
            <SecondaryActionIcon className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="rounded-2xl" onClick={onAction} disabled={!onAction} aria-label={actionLabel}>
          <ActionIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

const BrandMark: React.FC<{
  className?: string;
}> = ({ className }) => {
  return <img src={authenticatorIcon} alt={APP_NAME} className={className} />;
};

const UserAvatar: React.FC<{
  user: FirebaseUser;
  className?: string;
  preview?: string;
}> = ({ user, className = 'h-10 w-10', preview }) => {
  const source = preview || user.photoURL;

  if (source) {
    return <img src={source} alt={user.displayName || APP_NAME} className={`rounded-2xl border border-border object-cover ${className}`} referrerPolicy="no-referrer" />;
  }

  return (
    <div className={`flex items-center justify-center rounded-2xl border border-border bg-background/70 ${className}`}>
      <User className="h-4 w-4 text-muted-foreground" />
    </div>
  );
};
