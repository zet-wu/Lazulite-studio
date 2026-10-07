import { Icon } from '../shared/Icon';
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  studioApi,
  uploadAsset,
  type Asset,
} from "../adapters/http/client";
import styles from "./create-project.module.css";

type Status = "idle" | "uploading" | "creating" | "done";

export function CreateProject({
  onCreated,
}: {
  onCreated: (id: string) => void;
}) {
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
  const [error, setError] = useState("");
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
    setError("已取消上传");
  };
  const close = () => {
    if (status === "uploading") {
      cancelUpload();
      dialog.current?.close();
    } else if (status !== "creating") dialog.current?.close();
  };
  const submit = async () => {
    if (status !== "idle") return;
    if (!name.trim() || (!file && !asset)) {
      setError("请填写项目名称并选择音频文件");
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
        uploaded = await uploadAsset(
          file,
          (value) => {
            if (token.current === current) setProgress(value);
          },
          active.signal,
        );
        if (token.current !== current) return;
        setAsset(uploaded);
      }
      if (!uploaded || token.current !== current) return;
      const active = new AbortController();
      controller.current = active;
      setStatus("creating");
      const project = await studioApi.createProject(
        name.trim(),
        uploaded.id,
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
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "登录已失效，请重新登录后重试"
          : caught instanceof ApiError
            ? caught.body.message
            : "操作失败，请重试",
      );
      setStatus("idle");
    } finally {
      if (token.current === current) controller.current = null;
    }
  };

  return (
    <>
      <button data-role="secondary" className={styles.primary} onClick={open}>
        <Icon name="add"/> 新建项目
      </button>
      <dialog
        ref={dialog}
        className={styles.modal}
        onCancel={(event) => {
          if (status === "creating") event.preventDefault();
          else if (status === "uploading") cancelUpload();
        }}
      >
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2>新建项目</h2>
          <label>
            项目名称
            <input
              value={name}
              onChange={(event) => {
                touchedName.current = true;
                setName(event.target.value);
              }}
              disabled={status !== "idle" || Boolean(asset)}
            />
          </label>
          <label>
            音频文件
            <input
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
                  ? "正在处理音频…"
                  : `正在上传 ${Math.round(progress * 100)}%`}
              </span>
            </>
          )}
          {status === "creating" && (
            <span className={styles.hint}>正在创建项目…</span>
          )}
          {error && (
            <p className={styles.error}>
              {error}
              {error.includes("登录") && (
                <>
                  {" "}
                  · <a href="/login">重新登录</a>
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
              取消
            </button>
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
                取消上传
              </button>
            ) : (
              <button data-role="primary"
                key="submit-project"
                type="submit"
                className={styles.primary}
                disabled={status === "creating"}
              >
                {asset ? "重试创建" : "上传并创建"}
              </button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
