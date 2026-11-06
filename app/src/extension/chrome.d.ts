/* The slice of the extension API this target calls, typed by hand: @types/chrome is not a dependency. */

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      id?: string;
      url?: string;
      tab?: tabs.Tab;
    }
    interface Port {
      name: string;
      sender?: MessageSender;
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: { addListener(cb: (message: unknown, port: Port) => void): void };
      onDisconnect: { addListener(cb: (port: Port) => void): void };
    }
    const id: string | undefined;
    function connect(info: { name: string }): Port;
    function getURL(path: string): string;
    function openOptionsPage(): Promise<void>;
    const onConnect: { addListener(cb: (port: Port) => void): void };
  }

  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: StorageArea;
    const onChanged: {
      addListener(cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId: number;
      url?: string;
      active: boolean;
    }
    function query(info: { active?: boolean; windowId?: number }): Promise<Tab[]>;
    function captureVisibleTab(windowId?: number, options?: { format?: "png" | "jpeg"; quality?: number }): Promise<string>;
    const onActivated: { addListener(cb: (info: { tabId: number; windowId: number }) => void): void };
  }

  namespace windows {
    function getCurrent(): Promise<{ id?: number }>;
  }

  namespace sidePanel {
    function setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
  }

  namespace permissions {
    function request(permissions: { origins: string[] }): Promise<boolean>;
    function contains(permissions: { origins: string[] }): Promise<boolean>;
  }
}
