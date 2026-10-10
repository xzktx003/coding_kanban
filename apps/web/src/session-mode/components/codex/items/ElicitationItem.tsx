import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import "./request-native.css";
import { useTranslation } from "react-i18next";
import {
  elicitationChoices,
  isApprovalElicitation,
  useElicitationStore,
} from "../stores/useElicitationStore";
import {
  elicitationFields,
  elicitationFieldOptions,
  initialElicitationValues,
  isElicitationSingleChoice,
  allowsElicitationCustomValue,
  elicitationDraftValues,
  unsupportedElicitationField,
  validateElicitationValues,
  type ElicitationField,
} from "../stores/elicitationFields";
import type { ElicitationRequest } from "../stores/useElicitationStore";
import { rpcKey, useRpcDeliveryStore } from "../stores/rpcLifecycle";
import { RpcDeliveryNotice } from "./RpcDeliveryNotice";
import {
  NativeRequestClose,
  NativeRequestNext,
  NativeRequestPrevious,
} from "./ApprovalItem.icons";
import { uploadBrowserFile } from "@session/browser-dialog";

export function ElicitationItem({
  currentThreadId,
  onPickFile,
}: {
  currentThreadId: string | null;
  /** Native ordinary MCP cards have no file-pick callback. Only an explicit
   * capable caller exposes this action; browser callers may return a File. */
  onPickFile?: (
    request: ElicitationRequest,
    field: ElicitationField,
  ) => Promise<File | string | null>;
}) {
  const {
    pendingRequests,
    drafts,
    setFieldValue,
    setFieldErrors,
    setFieldIndex,
    setCollapsed,
    setCustomDraft,
    respond,
  } = useElicitationStore();
  const request =
    pendingRequests.find((pending) => pending.threadId === currentThreadId) ??
    null;
  const fields = useMemo(
    () => (request ? elicitationFields(request) : []),
    [request],
  );
  const defaults = useMemo(() => initialElicitationValues(fields), [fields]);
  const key = request ? rpcKey(request) : "";
  const delivery = useRpcDeliveryStore((state) => state.states[key]);
  const { t } = useTranslation("thread");
  const inputId = useId();
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uploads, setUploads] = useState<
    Record<string, { busy: boolean; error?: string }>
  >({});
  const [portraits, setPortraits] = useState<Record<string, boolean>>({});
  const gallery = useRef<HTMLDivElement>(null);
  const [galleryScroll, setGalleryScroll] = useState({
    previous: false,
    next: false,
  });
  const fieldIndex = drafts[key]?.fieldIndex ?? 0;
  const collapsed = drafts[key]?.collapsed ?? false;
  const blocked =
    delivery?.phase === "submitting" ||
    delivery?.phase === "uncertain" ||
    uploads[key]?.busy === true;
  const clearAdvance = () => {
    if (advanceTimer.current != null) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  };
  useEffect(() => clearAdvance, [key, fieldIndex, blocked, collapsed]);
  useEffect(() => {
    const node = gallery.current;
    if (!node) return;
    const update = () => {
      const previous = node.scrollLeft > 1,
        next = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      setGalleryScroll((old) =>
        old.previous === previous && old.next === next
          ? old
          : { previous, next },
      );
    };
    update();
    node.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [key, fieldIndex, collapsed, portraits]);
  if (!request) return null;

  const draft = drafts[key];
  const values = draft?.values ?? defaults;
  const errors = draft?.errors ?? {};
  const customDrafts = draft?.customDrafts ?? {};
  const approval = isApprovalElicitation(request);
  const unsupported = unsupportedElicitationField(request);
  const activeField = fields[fieldIndex];
  const uploadFile = async (field: ElicitationField) => {
    if (blocked || unsupported || !onPickFile) return;
    clearAdvance();
    const target = request;
    setUploads((old) => ({ ...old, [key]: { busy: true } }));
    try {
      const file = await onPickFile(target, field);
      if (file === null) {
        setUploads((old) => ({ ...old, [key]: { busy: false } }));
        return;
      }
      const path =
        typeof file === "string" ? file : await uploadBrowserFile(file);
      if (typeof path === "string" && path.startsWith("file://")) {
        if (new URL(path).protocol !== "file:")
          throw new Error(t("elicitation.invalidUploadPath"));
        if (useElicitationStore.getState().pendingRequests.includes(target))
          useElicitationStore.getState().setFieldValue(target, field.id, path);
        setUploads((old) => ({ ...old, [key]: { busy: false } }));
        return;
      }
      if (
        typeof path !== "string" ||
        !path.startsWith("/") ||
        path.includes("\0")
      )
        throw new Error(t("elicitation.invalidUploadPath"));
      const uri = new URL("file:///");
      uri.pathname = path;
      if (useElicitationStore.getState().pendingRequests.includes(target))
        useElicitationStore
          .getState()
          .setFieldValue(target, field.id, uri.href);
      setUploads((old) => ({ ...old, [key]: { busy: false } }));
    } catch (error) {
      setUploads((old) => ({
        ...old,
        [key]: {
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };
  const singleChoice =
    activeField != null && isElicitationSingleChoice(activeField);
  const showSubmit =
    !singleChoice ||
    elicitationFieldOptions(activeField).some(
      (option) => option.value === values[activeField.id],
    ) ||
    (allowsElicitationCustomValue(activeField) &&
      typeof values[activeField.id] === "string" &&
      (values[activeField.id] as string).length > 0);
  const submitChoice = (
    action: "accept" | "decline" | "cancel",
    persist?: string,
  ) => {
    if (blocked) return;
    clearAdvance();
    void respond(
      request.requestId,
      action,
      null,
      persist ? { persist } : null,
      request,
    ).catch(() => {});
  };
  const submitForm = () => {
    if (blocked || unsupported) return;
    clearAdvance();
    if (fieldIndex < fields.length - 1) {
      const validated = validateElicitationValues(
        [fields[fieldIndex]],
        elicitationDraftValues(fields, values, customDrafts),
      );
      setFieldErrors(request, validated.errors);
      if (validated.content) setFieldIndex(request, fieldIndex + 1);
      return;
    }
    const validated = validateElicitationValues(
      fields,
      elicitationDraftValues(fields, values, customDrafts),
    );
    setFieldErrors(request, validated.errors);
    if (!validated.content) {
      const invalidIndex = fields.findIndex((field) =>
        Object.hasOwn(validated.errors, field.id),
      );
      if (invalidIndex >= 0) setFieldIndex(request, invalidIndex);
    }
    if (validated.content) {
      void respond(
        request.requestId,
        "accept",
        validated.content,
        null,
        request,
      ).catch(() => {});
    }
  };

  const navigate = (index: number) => {
    if (!blocked) {
      clearAdvance();
      setFieldIndex(request, index);
    }
  };
  const changeValue = (fieldId: string, value: unknown, advance = false) => {
    if (blocked) return;
    clearAdvance();
    const field = fields.find((field) => field.id === fieldId);
    if (
      field?.schema.type === "string" &&
      allowsElicitationCustomValue(field)
    ) {
      const previous = customDrafts[fieldId];
      if (previous?.selected)
        setCustomDraft(request, fieldId, { ...previous, selected: false });
    }
    setFieldValue(request, fieldId, value);
    if (advance && fieldIndex < fields.length - 1) {
      const target = request,
        targetKey = key,
        index = fieldIndex;
      advanceTimer.current = setTimeout(() => {
        advanceTimer.current = null;
        const state = useElicitationStore.getState();
        const current = state.drafts[targetKey];
        const phase = useRpcDeliveryStore.getState().states[targetKey]?.phase;
        if (
          !state.pendingRequests.includes(target) ||
          current?.fieldIndex !== index ||
          current.collapsed ||
          phase === "submitting" ||
          phase === "uncertain"
        )
          return;
        if (validateElicitationValues([fields[index]], current.values).content)
          state.setFieldIndex(target, index + 1);
      }, 180);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      approval ||
      request.mode === "url" ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      clearAdvance();
      setCollapsed(request, true);
      return;
    }
    if (blocked || collapsed || unsupported || event.repeat) return;
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey
    ) {
      event.preventDefault();
      submitForm();
      return;
    }
    const target = event.target;
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (target instanceof Element &&
        target.closest(
          'textarea, select, input:not([type="radio"]):not([type="checkbox"]), [contenteditable]:not([contenteditable="false"])',
        ))
    )
      return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      navigate(fieldIndex + (event.key === "ArrowRight" ? 1 : -1));
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const field = fields[fieldIndex];
      if (!field) return;
      if (field.schema.type === "openai/imagePicker") return;
      const options = elicitationFieldOptions(field);
      const option = options[Number(event.key) - 1];
      if (!option) {
        if (
          Number(event.key) === options.length + 1 &&
          allowsElicitationCustomValue(field)
        ) {
          event.preventDefault();
          clearAdvance();
          const custom = customDrafts[field.id] ?? {
            text: "",
            selected: false,
          };
          setCustomDraft(request, field.id, {
            ...custom,
            selected: field.schema.type === "array" ? !custom.selected : true,
          });
        }
        return;
      }
      event.preventDefault();
      const value = values[field.id];
      changeValue(
        field.id,
        field.schema.type === "array"
          ? Array.isArray(value) && value.includes(option.value)
            ? value.filter((item) => item !== option.value)
            : [...(Array.isArray(value) ? value : []), option.value]
          : option.value,
        field.schema.type === "string" && !allowsElicitationCustomValue(field),
      );
    }
  };

  return (
    <section
      className="codex-elicitation"
      aria-label={t("elicitation.requestsInformation", {
        serverName: request.serverName,
      })}
      aria-busy={delivery?.phase === "submitting"}
      onKeyDown={handleKeyDown}
    >
      <header className="codex-elicitation__header">
        {(approval || request.mode === "url") && (
          <span className="codex-elicitation__server">
            {request.serverName}
          </span>
        )}
        <span className="codex-elicitation__title">
          {request.mode === "url"
            ? t("elicitation.authorizationRequired")
            : approval
              ? t("elicitation.approvalRequired")
              : request.message}
        </span>
        {!collapsed && fields.length > 1 && (
          <div className="codex-elicitation__navigation">
            <button
              type="button"
              aria-label={t("userInput.previous")}
              disabled={blocked || fieldIndex === 0}
              onClick={() => navigate(fieldIndex - 1)}
            >
              <NativeRequestPrevious />
            </button>
            <span role="status">
              {t("elicitation.progress", {
                current: fieldIndex + 1,
                total: fields.length,
              })}
            </span>
            <button
              type="button"
              aria-label={t("userInput.next")}
              disabled={blocked || fieldIndex >= fields.length - 1}
              onClick={() => navigate(fieldIndex + 1)}
            >
              <NativeRequestNext />
            </button>
          </div>
        )}
        {!approval && request.mode !== "url" && (
          <button
            type="button"
            className="codex-elicitation__collapse"
            aria-label={t(
              collapsed ? "userInput.expand" : "elicitation.collapseForm",
            )}
            aria-expanded={!collapsed}
            title={t(
              collapsed ? "userInput.expand" : "elicitation.collapseForm",
            )}
            onClick={() => {
              clearAdvance();
              setCollapsed(request, !collapsed);
            }}
          >
            {collapsed ? (
              <span aria-hidden="true">⌄</span>
            ) : (
              <NativeRequestClose />
            )}
          </button>
        )}
        {!collapsed &&
          !approval &&
          request.mode !== "url" &&
          fields[fieldIndex]?.schema.type !== "boolean" && (
            <div className="codex-elicitation__field-heading">
              {fields[fieldIndex]?.label}
            </div>
          )}
      </header>
      {(approval || request.mode === "url") && (
        <div className="codex-elicitation__message">{request.message}</div>
      )}
      <RpcDeliveryNotice request={request} />
      {uploads[key]?.busy && (
        <div className="codex-elicitation__description" role="status">
          {t("elicitation.uploadingFile")}
        </div>
      )}
      {uploads[key]?.error && (
        <div className="codex-elicitation__error" role="alert">
          {uploads[key].error}
        </div>
      )}

      {request.mode === "url" ? (
        <div className="codex-elicitation__actions">
          <button
            type="button"
            onClick={() =>
              window.open(request.url, "_blank", "noopener,noreferrer")
            }
          >
            {t("elicitation.openLink")}
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => submitChoice("accept")}
          >
            {t("common.done")}
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => submitChoice("cancel")}
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : approval ? (
        <div className="codex-elicitation__actions">
          {elicitationChoices(request).map((choice) => (
            <button
              type="button"
              key={`${choice.action}-${choice.persist ?? "once"}`}
              disabled={blocked}
              title={choice.description}
              data-primary={
                (choice.action === "accept" && !choice.persist) || undefined
              }
              onClick={() => submitChoice(choice.action, choice.persist)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : collapsed ? null : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submitForm();
          }}
        >
          {unsupported && (
            <p
              className="codex-elicitation__error"
              role="alert"
              data-unsupported-field={unsupported.field}
              data-unsupported-kind={unsupported.kind}
            >
              {t("elicitation.unsupportedField", unsupported)}
            </p>
          )}
          <div className="codex-elicitation__fields">
            {fields.map((field, index) => {
              if (index !== fieldIndex) return null;
              const schema = field.schema;
              const options = elicitationFieldOptions(field);
              const allowCustom = allowsElicitationCustomValue(field);
              const custom = Object.hasOwn(customDrafts, field.id)
                ? customDrafts[field.id]
                : { text: "", selected: false };
              const value = Object.hasOwn(values, field.id)
                ? values[field.id]
                : undefined;
              const error = Object.hasOwn(errors, field.id)
                ? errors[field.id]
                : undefined;
              const id = `${inputId}-${index}`;
              const descriptionId = `${id}-description`;
              const errorId = `${id}-error`;
              const describedBy =
                [field.description ? descriptionId : "", error ? errorId : ""]
                  .filter(Boolean)
                  .join(" ") || undefined;
              const inputProps = {
                disabled: blocked,
                "aria-label": field.label,
                "aria-required": field.required,
                "aria-invalid": error ? true : undefined,
                "aria-describedby": describedBy,
              };
              return (
                <div key={field.id} className="codex-elicitation__field">
                  {field.description && (
                    <div
                      id={descriptionId}
                      className="codex-elicitation__description"
                    >
                      {field.description}
                    </div>
                  )}
                  {schema.type === "openai/imagePicker" ? (
                    <div className="codex-elicitation__image-carousel">
                      <div
                        ref={gallery}
                        className="codex-elicitation__image-picker"
                        data-portrait={
                          portraits[JSON.stringify([key, field.id])] ||
                          undefined
                        }
                        role="radiogroup"
                        aria-label={field.label}
                        aria-required={field.required}
                      >
                        {schema.file && onPickFile && (
                          <button
                            type="button"
                            className="codex-elicitation__image-option"
                            disabled={blocked}
                            data-selected={
                              typeof value === "string" &&
                              value.startsWith("file://")
                            }
                            aria-label={
                              schema.file.title ?? t("elicitation.chooseFile")
                            }
                            onClick={() => void uploadFile(field)}
                          >
                            <span className="codex-elicitation__image-frame">
                              <span aria-hidden="true">＋</span>
                            </span>
                            <span>
                              {schema.file.title ?? t("elicitation.chooseFile")}
                            </span>
                            {typeof value === "string" &&
                              value.startsWith("file://") && (
                                <span className="codex-elicitation__description">
                                  {decodeURIComponent(new URL(value).pathname)
                                    .split("/")
                                    .pop()}
                                </span>
                              )}
                          </button>
                        )}
                        {schema.items.map((item, itemIndex) => (
                          <label
                            key={item.id}
                            className="codex-elicitation__image-option"
                            data-selected={value === item.id}
                          >
                            <input
                              type="radio"
                              className="codex-elicitation__choice-input"
                              name={`${key}-${field.id}`}
                              aria-label={item.title}
                              value={item.id}
                              checked={value === item.id}
                              disabled={blocked}
                              onChange={() => changeValue(field.id, item.id)}
                            />
                            <span className="codex-elicitation__image-frame">
                              <img
                                src={item.image}
                                alt=""
                                draggable={false}
                                loading="lazy"
                                decoding="async"
                                onLoad={
                                  itemIndex === 0
                                    ? (event) => {
                                        const img = event.currentTarget;
                                        setPortraits((old) => ({
                                          ...old,
                                          [JSON.stringify([key, field.id])]:
                                            img.naturalHeight >
                                            img.naturalWidth,
                                        }));
                                      }
                                    : undefined
                                }
                              />
                            </span>
                            <span>{item.title}</span>
                          </label>
                        ))}
                      </div>
                      <div className="codex-elicitation__gallery-navigation">
                        {([-1, 1] as const).map((direction) => (
                          <button
                            type="button"
                            key={direction}
                            aria-label={t(
                              direction === -1
                                ? "elicitation.previousTemplates"
                                : "elicitation.moreTemplates",
                            )}
                            disabled={
                              blocked ||
                              !(direction === -1
                                ? galleryScroll.previous
                                : galleryScroll.next)
                            }
                            onClick={() =>
                              gallery.current?.scrollBy?.({
                                left:
                                  direction * gallery.current.clientWidth * 0.8,
                                behavior: window.matchMedia(
                                  "(prefers-reduced-motion: reduce)",
                                ).matches
                                  ? "auto"
                                  : "smooth",
                              })
                            }
                          >
                            {direction === -1 ? (
                              <NativeRequestPrevious />
                            ) : (
                              <NativeRequestNext />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : schema.type === "array" ||
                    isElicitationSingleChoice(field) ? (
                    <fieldset
                      className="codex-elicitation__choices"
                      disabled={blocked}
                      aria-label={field.label}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={describedBy}
                    >
                      {options.map((option, optionIndex) => {
                        const multiple = schema.type === "array";
                        const selected = multiple
                          ? Array.isArray(value) && value.includes(option.value)
                          : !custom.selected && value === option.value;
                        return (
                          <label
                            key={option.value}
                            className="codex-elicitation__choice"
                            data-selected={selected}
                          >
                            <input
                              className="codex-elicitation__choice-input"
                              type={multiple ? "checkbox" : "radio"}
                              name={`${key}-${field.id}`}
                              checked={selected}
                              aria-label={option.label}
                              aria-invalid={error ? true : undefined}
                              aria-describedby={describedBy}
                              onChange={() =>
                                changeValue(
                                  field.id,
                                  multiple
                                    ? selected
                                      ? (value as string[]).filter(
                                          (item) => item !== option.value,
                                        )
                                      : [
                                          ...(Array.isArray(value)
                                            ? value
                                            : []),
                                          option.value,
                                        ]
                                    : option.value,
                                  !multiple && !allowCustom,
                                )
                              }
                            />
                            <span
                              className={
                                multiple
                                  ? "codex-elicitation__choice-mark"
                                  : "codex-elicitation__choice-index"
                              }
                              aria-hidden="true"
                            >
                              {selected ? "✓" : multiple ? "" : optionIndex + 1}
                            </span>
                            <span className="codex-elicitation__choice-copy">
                              <span>{option.label}</span>
                              {option.description && (
                                <span className="codex-elicitation__description">
                                  {option.description}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                      {allowCustom &&
                        schema.type === "array" &&
                        Array.isArray(value) &&
                        value.map((item, itemIndex) =>
                          options.some((option) => option.value === item) &&
                          value.indexOf(item) === itemIndex ? null : (
                            <label
                              key={`custom-${itemIndex}`}
                              className="codex-elicitation__choice"
                              data-selected="true"
                            >
                              <input
                                className="codex-elicitation__choice-input"
                                type="checkbox"
                                aria-label={String(item)}
                                checked
                                onChange={() =>
                                  changeValue(
                                    field.id,
                                    value.filter(
                                      (_, index) => index !== itemIndex,
                                    ),
                                  )
                                }
                              />
                              <span
                                className="codex-elicitation__choice-mark"
                                aria-hidden="true"
                              >
                                ✓
                              </span>
                              <span>{String(item)}</span>
                            </label>
                          ),
                        )}
                      {allowCustom && (
                        <label
                          className="codex-elicitation__choice"
                          data-selected={custom.selected}
                        >
                          <input
                            className="codex-elicitation__choice-input"
                            type={
                              schema.type === "array" ? "checkbox" : "radio"
                            }
                            name={`${key}-${field.id}`}
                            aria-label={t("userInput.other")}
                            checked={custom.selected}
                            onChange={() => {
                              clearAdvance();
                              setCustomDraft(request, field.id, {
                                ...custom,
                                selected:
                                  schema.type === "array"
                                    ? !custom.selected
                                    : true,
                              });
                            }}
                          />
                          <span
                            className={
                              schema.type === "array"
                                ? "codex-elicitation__choice-mark"
                                : "codex-elicitation__choice-index"
                            }
                            aria-hidden="true"
                          >
                            {custom.selected
                              ? "✓"
                              : schema.type === "array"
                                ? ""
                                : options.length + 1}
                          </span>
                          <textarea
                            className="codex-elicitation__custom-input"
                            {...inputProps}
                            rows={1}
                            placeholder={t("userInput.other")}
                            value={custom.text}
                            onFocus={() => {
                              clearAdvance();
                              if (!custom.selected)
                                setCustomDraft(request, field.id, {
                                  ...custom,
                                  selected: true,
                                });
                            }}
                            onChange={(event) => {
                              clearAdvance();
                              setCustomDraft(request, field.id, {
                                text: event.target.value,
                                selected: true,
                              });
                            }}
                            onKeyDown={(event) => {
                              if (
                                schema.type === "array" &&
                                event.key === "Enter" &&
                                !event.ctrlKey &&
                                !event.metaKey &&
                                !event.altKey &&
                                !event.shiftKey &&
                                !event.nativeEvent.isComposing &&
                                custom.selected &&
                                custom.text.length > 0
                              ) {
                                event.preventDefault();
                                event.stopPropagation();
                                clearAdvance();
                                setFieldValue(request, field.id, [
                                  ...(Array.isArray(value) ? value : []),
                                  custom.text,
                                ]);
                                setCustomDraft(request, field.id, {
                                  text: "",
                                  selected: false,
                                });
                              }
                            }}
                          />
                        </label>
                      )}
                    </fieldset>
                  ) : schema.type === "boolean" ? (
                    <label
                      className="codex-elicitation__choice"
                      data-selected={value === true}
                    >
                      <input
                        {...inputProps}
                        id={id}
                        className="codex-elicitation__choice-input"
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) =>
                          changeValue(field.id, event.target.checked)
                        }
                      />
                      <span
                        className="codex-elicitation__choice-mark"
                        aria-hidden="true"
                      >
                        {value === true ? "✓" : ""}
                      </span>
                      <span>{field.label}</span>
                    </label>
                  ) : schema.type === "string" &&
                    !("format" in schema && schema.format) ? (
                    <textarea
                      {...inputProps}
                      className="codex-elicitation__input"
                      id={id}
                      rows={
                        "maxLength" in schema && (schema.maxLength ?? 0) >= 200
                          ? 3
                          : 1
                      }
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) =>
                        changeValue(field.id, event.target.value)
                      }
                    />
                  ) : (
                    <input
                      {...inputProps}
                      className="codex-elicitation__input"
                      id={id}
                      type={
                        schema.type === "string"
                          ? "format" in schema && schema.format === "email"
                            ? "email"
                            : "format" in schema && schema.format === "uri"
                              ? "url"
                              : "format" in schema && schema.format === "date"
                                ? "date"
                                : "text"
                          : "number"
                      }
                      min={
                        "minimum" in schema
                          ? schema.type === "integer" && schema.minimum != null
                            ? Math.ceil(schema.minimum)
                            : schema.minimum
                          : undefined
                      }
                      max={"maximum" in schema ? schema.maximum : undefined}
                      step={
                        schema.type === "integer"
                          ? 1
                          : schema.type === "number"
                            ? "any"
                            : undefined
                      }
                      value={
                        typeof value === "string" || typeof value === "number"
                          ? value
                          : ""
                      }
                      onChange={(event) =>
                        changeValue(field.id, event.target.value)
                      }
                    />
                  )}
                  {error && (
                    <div
                      className="codex-elicitation__error"
                      id={errorId}
                      role="alert"
                    >
                      {t(`elicitation.validation.${error.kind}`, {
                        field: field.label,
                        ...error.params,
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="codex-elicitation__actions">
            {showSubmit && (
              <button
                type="submit"
                data-primary="true"
                disabled={blocked || Boolean(unsupported)}
              >
                {t(
                  fieldIndex < fields.length - 1
                    ? "common.continue"
                    : "common.submit",
                )}
              </button>
            )}
            <button
              type="button"
              disabled={blocked}
              onClick={() =>
                fieldIndex < fields.length - 1
                  ? navigate(fieldIndex + 1)
                  : submitChoice("decline")
              }
            >
              {t(
                fieldIndex < fields.length - 1
                  ? "elicitation.skipChoice"
                  : "common.decline",
              )}
            </button>
            <button
              type="button"
              disabled={blocked}
              title={t("elicitation.cancelRequest")}
              onClick={() => submitChoice("cancel")}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
