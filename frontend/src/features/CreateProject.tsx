import { errorMessage, message } from '../domain/messages';
import { useMessageText } from '../shared/useMessageText';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { Icon } from '../shared/Icon';
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  studioApi,
  uploadMusic,
  type Asset,
} from "../adapters/http/client";
import styles from "./create-project.module.css";

type Status = "idle" | "uploading" | "creating" | "done";

export function CreateProject({
  onCreated,
}: {
  onCreated: (id: string) => void;
}) {
  useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const token = useRef(0);
  const touchedName = useRef(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useMessageText("");
  const [sessionExpired,setSessionExpired]=useState(false);
  const [key, setKey] = useState("");

  useEffect(() => () => controller.current?.abort(), []);

  const open = () => {
    token.current += 1;
    touchedName.current = false;
    setName("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setAsset(null);
    setProgress(0);
    setError("");
    setStatus("idle");
    setKey(crypto.randomUUID());
    dialog.current?.showModal();
  };
  const cancelUpload = () => {
    token.current += 1;
    controller.current?.abort();
    controller.current = null;
    setStatus("idle");
    setProgress(0);
    setError(message('create.cancelled'));
  };
  const close = () => {
    if (asset && status !== 'creating') void studioApi.discardUpload(asset.id).catch(error => setError(errorMessage(error)));
    if (status === "uploading") {
      cancelUpload();
      dialog.current?.close();
    } else if (status !== "creating") dialog.current?.close();
  };
  const submit = async () => {
    if (status !== "idle") return;
    if (!name.trim()) {
      setError(message('create.nameRequired'));
      return;
    }
    const current = ++token.current;
    setError("");
    setProgress(0);
    try {
      let uploaded = asset;
      if (!uploaded && file) {
        const active = new AbortController();
        controller.current = active;
        setStatus("uploading");
        uploaded = await uploadMusic(
          file,
          (value) => {
            if (token.current === current) setProgress(value);
          },
          active.signal,
        );
        if (token.current !== current) return;
        setAsset(uploaded);
      }
      if (token.current !== current) return;
      const active = new AbortController();
      controller.current = active;
      setStatus("creating");
      const project = await studioApi.createProject(
        name.trim(),
        uploaded?.id ?? null,
        key,
        active.signal,
        file?.name,
      );
      if (token.current !== current) return;
      setStatus("done");
      onCreated(project.id);
    } catch (caught) {
      if (
        token.current !== current ||
        (caught as DOMException).name === "AbortError"
      )
        return;
      setSessionExpired(caught instanceof ApiError&&caught.status===401);
      setError(
        caught instanceof ApiError && caught.status === 401
          ? message('create.expired')
          : caught instanceof ApiError
            ? errorMessage(caught)
            : message('common.failed'),
      );
      setStatus("idle");
    } finally {
      if (token.current === current) controller.current = null;
    }
  };

  return (
    <>
      <button data-role="primary" className={`${styles.primary} ${styles.createButton}`} onClick={open}>
        <Icon name="add"/><span>{t('create.new')}</span>
      </button>
      <dialog
        ref={dialog}
        className={styles.modal}
        onCancel={(event) => {
          if (status === "creating") event.preventDefault();
          else { if (status === "uploading") cancelUpload(); if (asset) void studioApi.discardUpload(asset.id).catch(error => setError(errorMessage(error))); }
        }}
      >
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2>{t('create.new')}</h2>
          <label>
            {t('create.name')}<input
              value={name}
              onChange={(event) => {
                touchedName.current = true;
                setName(event.target.value);
              }}
              disabled={status !== "idle" || Boolean(asset)}
            />
          </label>
          <label>
            {t('create.audio')}<input
              ref={fileInput}
              type="file"
              accept="audio/*,video/mp4,.m4a"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                token.current += 1;
                controller.current?.abort();
                setFile(selected);
                setAsset(null);
                setKey(crypto.randomUUID());
                setProgress(0);
                setError("");
                setStatus("idle");
                if (selected && !touchedName.current)
                  setName(selected.name.replace(/\.[^.]+$/, ""));
              }}
              disabled={Boolean(asset) || status !== "idle"}
            />
          </label>
          {status === "uploading" && (
            <>
              <progress max="1" value={progress} />
              <span className={styles.hint}>
                {progress >= 1
                  ? t('create.processing')
                  : t('project.uploadProgress',{percent:Math.round(progress*100)})}
              </span>
            </>
          )}
          {status === "creating" && (
            <span className={styles.hint}>{t('create.creating')}</span>
          )}
          {error && (
            <p className={styles.error}>
              {error}
              {sessionExpired && (
                <>
                  {" "}
                  · <a href="/login">{t('login.again')}</a>
                </>
              )}
            </p>
          )}
          <div className={styles.actions}>
            <button data-role="secondary"
              type="button"
              className={styles.secondary}
              onClick={close}
              disabled={status === "creating"}
            >
              {t('common.cancel')}</button>
            {status === "uploading" ? (
              <button data-role="secondary"
                key="cancel-upload"
                type="button"
                className={styles.secondary}
                onClick={(event) => {
                  event.preventDefault();
                  cancelUpload();
                }}
              >
                {t('create.cancelUpload')}</button>
            ) : (
              <button data-role="primary"
                key="submit-project"
                type="submit"
                className={styles.primary}
                disabled={status === "creating"}
              >
                {asset ? t('create.retry') : file ? t('create.uploadCreate') : t('create.create')}
              </button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}

const t=i18n.t.bind(i18n);
