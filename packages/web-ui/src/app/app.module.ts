import { NgModule } from '@angular/core';

import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';

import { PagesModule } from './@pages/pages.module';
import { SharedModule } from './@shared/shared.module';
import { ThemeModule } from './@theme/theme.module';
import { ToastrModule } from 'ngx-toastr';

import { AppComponent } from './app.component';
// Add these imports at the top with the other Angular Material imports
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';

const NG_MODULES = [
  BrowserModule,
  AppRoutingModule,
  BrowserAnimationsModule,
  CommonModule,
  HttpClientModule
];

const toastrOptionsObject = {
  positionClass: 'custom-toastr',
  maxOpened: 8,
  timeOut: 3000,
  countDuplicates: true,
};

const TL_MODULES = [
  PagesModule,
  SharedModule,
  ThemeModule,
  ToastrModule.forRoot(toastrOptionsObject),
];

const MATERIAL_MODULES = [
  MatDialogModule,
  MatFormFieldModule,
  MatSelectModule,
  MatButtonModule
];

const imports = [
  ...NG_MODULES,
  ...TL_MODULES,
  ...MATERIAL_MODULES
];

const declarations = [AppComponent];
const bootstrap = [AppComponent];
@NgModule({ declarations, imports, bootstrap })
export class AppModule { }
