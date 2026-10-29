import {useEffect,useState} from "react";
import {CapacitorHttp} from "@capacitor/core";
import {ExternalPlayer} from "./native";

type Episode={id:number;name:string};
type Props={url:string;title:string;position?:number;rutubeId?:string;episodes?:Episode[];episodeId?:number;autoNext?:boolean;onEpisode?:(id:number)=>void;onAutoNext?:(enabled:boolean)=>void;onProgress?:(position:number,duration:number,completed:boolean)=>void};

export default function SystemPlayer({url,title,position=0,rutubeId,onProgress}:Props){
  const [error,setError]=useState("");
  const open=async()=>{
    setError("");
    try{
      let source=url;
      if(rutubeId){
        if(!/^[a-f\d]{32}$/.test(rutubeId))throw new Error("Некорректная ссылка RuTube");
        const response=await CapacitorHttp.get({url:`https://rutube.ru/api/play/options/${rutubeId}/?format=json`,responseType:"json",connectTimeout:10000,readTimeout:15000});
        if(response.status!==200)throw new Error(`RuTube HTTP ${response.status}`);
        const data=typeof response.data==="string"?JSON.parse(response.data):response.data;
        source=data.video_balancer?.m3u8;
        if(typeof source!=="string"||new URL(source).protocol!=="https:")throw new Error("RuTube не предоставил поток для внешнего плеера");
      }
      const result=await ExternalPlayer.open({url:source,title,preferred:"system",positionMs:position*1000});
      if(result.completed||result.positionMs!==undefined||result.durationMs!==undefined)onProgress?.((result.positionMs??position*1000)/1000,(result.durationMs??0)/1000,Boolean(result.completed));
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason))}
  };
  useEffect(()=>{const timer=window.setTimeout(()=>void open(),0);return()=>window.clearTimeout(timer)},[url,title,position,rutubeId]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="system-player" aria-label="Системный плеер"><p>Видео открыто во внешнем приложении.</p><button onClick={()=>void open()}>Выбрать другой плеер</button>{error&&<p role="alert">{error}</p>}</section>;
}
