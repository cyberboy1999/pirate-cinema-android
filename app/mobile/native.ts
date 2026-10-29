import {registerPlugin} from "@capacitor/core";

export const Librqbit=registerPlugin<{
  initialize():Promise<{url:string;version:string}>;
  shutdown():Promise<void>;
  storage(options:{quotaGiB?:number}):Promise<{quotaGiB:number;usedBytes:number;availableBytes:number;warning:string}>;
}>("Librqbit");

export const ExternalPlayer=registerPlugin<{
  open(options:{url:string;title:string;preferred:"system";positionMs:number}):Promise<{ok:boolean;positionMs?:number;durationMs?:number;completed?:boolean}>;
}>("ExternalPlayer");
