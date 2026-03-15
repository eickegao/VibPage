// CLI-side WebSocket client for QR code remote control

import { randomUUID } from "crypto";
import { loadConfig } from "./config.js";

// @ts-ignore — qrcode-terminal has no type declarations
import qrcodeModule from "qrcode-terminal";

export type RemoteEventHandler = (event: RemoteEvent) => void;

export interface RemoteEvent {
  type: "connected" | "disconnected" | "prompt" | "error";
  text?: string;
  from?: string;
  message?: string;
}

export interface RemoteSession {
  sessionId: string;
  ws: WebSocket;
  send: (data: Record<string, unknown>) => void;
  close: () => void;
}

const REMOTE_TEXTS: Record<string, {
  scanning: string;
  orVisit: string;
  connected: string;
  disconnected: string;
  connectionLost: string;
  alreadyActive: string;
}> = {
  "zh-CN": {
    scanning: "扫描二维码连接手机遥控",
    orVisit: "或访问",
    connected: "手机已连接，终端输入已锁定",
    disconnected: "手机已断开，终端输入已恢复",
    connectionLost: "远程连接丢失",
    alreadyActive: "远程会话已激活",
  },
  "zh-TW": {
    scanning: "掃描 QR Code 連接手機遙控",
    orVisit: "或訪問",
    connected: "手機已連接，終端輸入已鎖定",
    disconnected: "手機已斷開，終端輸入已恢復",
    connectionLost: "遠程連接丟失",
    alreadyActive: "遠程會話已激活",
  },
  en: {
    scanning: "Scan QR code to connect phone remote",
    orVisit: "Or visit",
    connected: "Phone connected, terminal input locked",
    disconnected: "Phone disconnected, terminal input restored",
    connectionLost: "Remote connection lost",
    alreadyActive: "Remote session already active",
  },
  fr: {
    scanning: "Scannez le QR code pour connecter la télécommande",
    orVisit: "Ou visitez",
    connected: "Téléphone connecté, saisie terminale verrouillée",
    disconnected: "Téléphone déconnecté, saisie terminale restaurée",
    connectionLost: "Connexion distante perdue",
    alreadyActive: "Session distante déjà active",
  },
  de: {
    scanning: "QR-Code scannen um Handy-Fernsteuerung zu verbinden",
    orVisit: "Oder besuchen Sie",
    connected: "Handy verbunden, Terminal-Eingabe gesperrt",
    disconnected: "Handy getrennt, Terminal-Eingabe wiederhergestellt",
    connectionLost: "Fernverbindung verloren",
    alreadyActive: "Fernsitzung bereits aktiv",
  },
  es: {
    scanning: "Escanea el código QR para conectar el control remoto",
    orVisit: "O visita",
    connected: "Teléfono conectado, entrada de terminal bloqueada",
    disconnected: "Teléfono desconectado, entrada de terminal restaurada",
    connectionLost: "Conexión remota perdida",
    alreadyActive: "Sesión remota ya activa",
  },
  pt: {
    scanning: "Escaneie o QR code para conectar o controle remoto",
    orVisit: "Ou visite",
    connected: "Celular conectado, entrada do terminal bloqueada",
    disconnected: "Celular desconectado, entrada do terminal restaurada",
    connectionLost: "Conexão remota perdida",
    alreadyActive: "Sessão remota já ativa",
  },
  ko: {
    scanning: "QR 코드를 스캔하여 휴대폰 리모컨 연결",
    orVisit: "또는 방문",
    connected: "휴대폰 연결됨, 터미널 입력 잠금",
    disconnected: "휴대폰 연결 해제, 터미널 입력 복원",
    connectionLost: "원격 연결 끊김",
    alreadyActive: "원격 세션 이미 활성화됨",
  },
  ja: {
    scanning: "QRコードをスキャンしてスマホリモコンを接続",
    orVisit: "またはアクセス",
    connected: "スマホ接続済み、ターミナル入力ロック中",
    disconnected: "スマホ切断、ターミナル入力復元",
    connectionLost: "リモート接続が切断されました",
    alreadyActive: "リモートセッションは既にアクティブです",
  },
};

export function getRemoteTexts(lang: string) {
  return REMOTE_TEXTS[lang] || REMOTE_TEXTS["en"];
}

let activeSession: RemoteSession | null = null;

export function isRemoteActive(): boolean {
  return activeSession !== null;
}

export function getActiveSession(): RemoteSession | null {
  return activeSession;
}

export async function generateQrCode(url: string): Promise<string> {
  return new Promise((resolve) => {
    (qrcodeModule as any).generate(url, { small: true }, (qr: string) => {
      resolve(qr.trim());
    });
  });
}

export async function startRemoteSession(
  lang: string,
  onEvent: RemoteEventHandler
): Promise<RemoteSession | null> {
  if (activeSession) {
    return null;
  }

  const config = loadConfig();
  if (!config.proxyUrl) {
    onEvent({ type: "error", message: "Proxy URL not configured. Please login first." });
    return null;
  }

  const sessionId = randomUUID();
  const wsUrl = config.proxyUrl.replace("https://", "wss://").replace("http://", "ws://")
    + `/api/remote/${sessionId}?role=cli`;

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);

    const session: RemoteSession = {
      sessionId,
      ws,
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data));
        }
      },
      close: () => {
        activeSession = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      },
    };

    ws.addEventListener("open", () => {
      activeSession = session;
      resolve(session);
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : "");
        onEvent(msg as RemoteEvent);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      if (activeSession === session) {
        activeSession = null;
        onEvent({ type: "disconnected", from: "server" });
      }
    });

    ws.addEventListener("error", () => {
      if (activeSession === session) {
        activeSession = null;
        onEvent({ type: "error", message: "WebSocket connection failed" });
      }
      resolve(null);
    });
  });
}

export function stopRemoteSession(): void {
  if (activeSession) {
    activeSession.close();
    activeSession = null;
  }
}
