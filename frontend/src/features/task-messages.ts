import type {Job,JobRequest} from '../adapters/http/jobs';
import {message,type Message} from '../domain/messages';
import {i18n} from '../i18n';
export function taskError(error:NonNullable<Job['error']>):Message {
 const keys:Record<string,string>={device_failed:'task.deviceFailed',capability_unavailable:'task.capabilityUnavailable',publish_failed:'task.publishFailed',engine_error:'task.engineFailed'};
 return message(keys[error.code??'']??'error.unexpected',{diagnostic:error.message??error.code??''});
}
export function deviceSummary(devices:JobRequest['devices']):string {
 const keys:Record<string,string>={probe_incomplete:'device.probeIncomplete',runtime_failed:'device.runtimeFailed',cpu_failed:'device.cpuFailed',unavailable:'device.unavailable'};
 return Object.entries(devices??{}).map(([stage,device])=>{
  const key=keys[device.reason_code??''];
  const reason=key?i18n.t(key,{device:device.preferred}):device.reason;
  return `${i18n.t(stage==='vocal'?'settings.vocalSeparation':'settings.alignment')}: ${device.label}${reason?` (${reason})`:''}`;
 }).join(i18n.t('notice.separator'));
}
