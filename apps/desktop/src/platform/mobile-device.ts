import { registerPlugin } from "@capacitor/core";

type HiveDevicePlugin = {
  requestNotifications(): Promise<void>;
  setStatusBarAppearance(options: { light: boolean }): Promise<void>;
};

const hiveDevice = registerPlugin<HiveDevicePlugin>("HiveDevice");

export interface NotificationPermissionPort {
  requestNotifications(): Promise<void>;
}

export interface MobileDevicePort extends NotificationPermissionPort {
  setStatusBarAppearance(light: boolean): void;
}

/** Adapts Capacitor device permission and system-bar controls for the desktop/mobile host. */
export class MobileDeviceAdapter implements MobileDevicePort {
  constructor(private readonly android: boolean) {}

  requestNotifications(): Promise<void> {
    return this.android ? hiveDevice.requestNotifications() : Promise.resolve();
  }

  setStatusBarAppearance(light: boolean): void {
    if (this.android) void hiveDevice.setStatusBarAppearance({ light }).catch(() => {});
  }
}
