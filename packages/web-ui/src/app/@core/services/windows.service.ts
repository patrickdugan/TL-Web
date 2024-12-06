import { Injectable } from "@angular/core";

export interface IWindow {
  component: any,
  minimized: boolean,
  title: string,
}

@Injectable({
  providedIn: 'root',
})

export class WindowsService {
  private _tabs: IWindow[] = [];

  constructor() { }

  get tabs() {
    return this._tabs;
  }

  set tabs(tabs: IWindow[]) {
    this._tabs = tabs;
  }

  closeTab(title: string) {
    this.tabs = this.tabs.filter(e => e.title !== title);
  }
}
