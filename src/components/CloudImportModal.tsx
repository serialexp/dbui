// ABOUTME: Modal wizard for importing database connections from cloud providers.
// ABOUTME: Supports AWS Parameter Store, AWS Secrets Manager, and Kubernetes secrets.

import { createSignal, Show, For, onMount, onCleanup, createEffect } from "solid-js";
import { Icon } from "./Icon";
import type {
  AwsProfile,
  AwsParameter,
  AwsSecret,
  KubeContext,
  KubeNamespace,
  KubeSecret,
  KubeSecretKey,
  ParsedConnection,
  Category,
  SaveConnectionInput,
} from "../lib/types";
import {
  listAwsProfiles,
  listSsmParameters,
  getSsmParameterValue,
  listAwsSecrets,
  getAwsSecretValue,
  listKubeContexts,
  listKubeNamespaces,
  listKubeSecrets,
  listKubeSecretKeys,
  getKubeSecretValue,
  parseConnectionUrl,
  saveConnection,
} from "../lib/tauri";

import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import arrowLeftSvg from "@phosphor-icons/core/assets/regular/arrow-left.svg?raw";
import arrowRightSvg from "@phosphor-icons/core/assets/regular/arrow-right.svg?raw";
import checkSvg from "@phosphor-icons/core/assets/regular/check.svg?raw";

type CloudProvider = "aws-ssm" | "aws-secrets" | "kubernetes";

interface Props {
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

export function CloudImportModal(props: Props) {
  const [step, setStep] = createSignal(1);
  const [provider, setProvider] = createSignal<CloudProvider | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // AWS state
  const [awsProfiles, setAwsProfiles] = createSignal<AwsProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = createSignal("");
  const [region, setRegion] = createSignal("us-east-1");
  const [pathPrefix, setPathPrefix] = createSignal("");
  const [ssmParameters, setSsmParameters] = createSignal<AwsParameter[]>([]);
  const [awsSecrets, setAwsSecrets] = createSignal<AwsSecret[]>([]);
  const [selectedParameter, setSelectedParameter] = createSignal<string | null>(null);
  const [selectedSecret, setSelectedSecret] = createSignal<string | null>(null);

  // Kubernetes state
  const [kubeContexts, setKubeContexts] = createSignal<KubeContext[]>([]);
  const [selectedContext, setSelectedContext] = createSignal("");
  const [kubeNamespaces, setKubeNamespaces] = createSignal<KubeNamespace[]>([]);
  const [selectedNamespace, setSelectedNamespace] = createSignal("");
  const [kubeSecrets, setKubeSecrets] = createSignal<KubeSecret[]>([]);
  const [selectedKubeSecret, setSelectedKubeSecret] = createSignal<string | null>(null);
  const [kubeSecretKeys, setKubeSecretKeys] = createSignal<KubeSecretKey[]>([]);
  const [selectedKey, setSelectedKey] = createSignal("");

  // Preview state
  const [secretValue, setSecretValue] = createSignal("");
  const [parsedConnection, setParsedConnection] = createSignal<ParsedConnection | null>(null);
  const [connectionName, setConnectionName] = createSignal("");
  const [categoryId, setCategoryId] = createSignal<string | null>(null);
  const [parseError, setParseError] = createSignal<string | null>(null);

  // Search filter
  const [searchFilter, setSearchFilter] = createSignal("");

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const loadAwsProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const profiles = await listAwsProfiles();
      setAwsProfiles(profiles);
      if (profiles.length > 0) {
        setSelectedProfile(profiles[0].name);
        if (profiles[0].region) {
          setRegion(profiles[0].region);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadKubeContexts = async () => {
    setLoading(true);
    setError(null);
    try {
      const contexts = await listKubeContexts();
      setKubeContexts(contexts);
      if (contexts.length > 0) {
        setSelectedContext(contexts[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleProviderSelect = async (p: CloudProvider) => {
    setProvider(p);
    setError(null);

    if (p === "aws-ssm" || p === "aws-secrets") {
      await loadAwsProfiles();
    } else if (p === "kubernetes") {
      await loadKubeContexts();
    }

    setStep(2);
  };

  const loadSsmParameters = async () => {
    setLoading(true);
    setError(null);
    setSsmParameters([]);
    try {
      const params = await listSsmParameters(
        selectedProfile(),
        region(),
        pathPrefix() || undefined
      );
      setSsmParameters(params);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadAwsSecrets = async () => {
    setLoading(true);
    setError(null);
    setAwsSecrets([]);
    try {
      const secrets = await listAwsSecrets(selectedProfile(), region());
      setAwsSecrets(secrets);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadKubeNamespaces = async () => {
    setLoading(true);
    setError(null);
    setKubeNamespaces([]);
    setSelectedNamespace("");
    try {
      const namespaces = await listKubeNamespaces(selectedContext());
      setKubeNamespaces(namespaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadKubeSecrets = async () => {
    setLoading(true);
    setError(null);
    setKubeSecrets([]);
    try {
      const secrets = await listKubeSecrets(selectedContext(), selectedNamespace());
      setKubeSecrets(secrets);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadKubeSecretKeys = async (secretName: string) => {
    setLoading(true);
    setError(null);
    setKubeSecretKeys([]);
    try {
      const keys = await listKubeSecretKeys(
        selectedContext(),
        selectedNamespace(),
        secretName
      );
      setKubeSecretKeys(keys);
      if (keys.length > 0) {
        setSelectedKey(keys[0].key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async () => {
    if (step() === 2) {
      // Load secrets based on provider
      if (provider() === "aws-ssm") {
        await loadSsmParameters();
      } else if (provider() === "aws-secrets") {
        await loadAwsSecrets();
      } else if (provider() === "kubernetes") {
        await loadKubeNamespaces();
      }
      setStep(3);
    } else if (step() === 3) {
      // For kubernetes, if we just selected namespace, load secrets
      if (provider() === "kubernetes" && kubeSecrets().length === 0) {
        await loadKubeSecrets();
        return;
      }
      // Move to preview step - fetch the secret value
      await fetchSecretValue();
      setStep(4);
    }
  };

  const fetchSecretValue = async () => {
    setLoading(true);
    setError(null);
    setParseError(null);

    try {
      let value = "";

      if (provider() === "aws-ssm" && selectedParameter()) {
        value = await getSsmParameterValue(
          selectedProfile(),
          region(),
          selectedParameter()!
        );
      } else if (provider() === "aws-secrets" && selectedSecret()) {
        value = await getAwsSecretValue(
          selectedProfile(),
          region(),
          selectedSecret()!
        );
      } else if (provider() === "kubernetes" && selectedKubeSecret() && selectedKey()) {
        value = await getKubeSecretValue(
          selectedContext(),
          selectedNamespace(),
          selectedKubeSecret()!,
          selectedKey()
        );
      }

      setSecretValue(value);

      // Try to parse the URL
      try {
        const parsed = await parseConnectionUrl(value);
        setParsedConnection(parsed);

        // Set default connection name from database or secret name
        const defaultName =
          parsed.database ||
          selectedParameter() ||
          selectedSecret() ||
          selectedKubeSecret() ||
          "Imported Connection";
        setConnectionName(defaultName.split("/").pop() || defaultName);
      } catch (parseErr) {
        setParseError(
          "Not a valid connection URL. Expected: postgres://user:pass@host:port/db"
        );
        setParsedConnection(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step() === 2) {
      setProvider(null);
      setStep(1);
    } else if (step() === 3) {
      // Reset selection state
      setSelectedParameter(null);
      setSelectedSecret(null);
      setSelectedKubeSecret(null);
      setSsmParameters([]);
      setAwsSecrets([]);
      setKubeSecrets([]);
      setStep(2);
    } else if (step() === 4) {
      setStep(3);
    }
  };

  const handleImport = async () => {
    const parsed = parsedConnection();
    if (!parsed || !connectionName()) return;

    setLoading(true);
    setError(null);

    try {
      const input: SaveConnectionInput = {
        name: connectionName(),
        db_type: parsed.db_type,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        database: parsed.database,
        category_id: categoryId(),
      };

      await saveConnection(input);
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Update region when profile changes
  createEffect(() => {
    const profile = awsProfiles().find((p) => p.name === selectedProfile());
    if (profile?.region) {
      setRegion(profile.region);
    }
  });

  // Load kube secrets when namespace changes
  createEffect(() => {
    if (provider() === "kubernetes" && selectedNamespace() && step() === 3) {
      loadKubeSecrets();
    }
  });

  // Load secret keys when kube secret is selected
  createEffect(() => {
    if (selectedKubeSecret()) {
      loadKubeSecretKeys(selectedKubeSecret()!);
    }
  });

  const filteredSsmParameters = () => {
    const filter = searchFilter().toLowerCase();
    if (!filter) return ssmParameters();
    return ssmParameters().filter((p) => p.name.toLowerCase().includes(filter));
  };

  const filteredAwsSecrets = () => {
    const filter = searchFilter().toLowerCase();
    if (!filter) return awsSecrets();
    return awsSecrets().filter((s) => s.name.toLowerCase().includes(filter));
  };

  const filteredKubeSecrets = () => {
    const filter = searchFilter().toLowerCase();
    if (!filter) return kubeSecrets();
    return kubeSecrets().filter((s) => s.name.toLowerCase().includes(filter));
  };

  const canProceed = () => {
    if (step() === 2) {
      if (provider() === "aws-ssm" || provider() === "aws-secrets") {
        return selectedProfile() && region();
      }
      if (provider() === "kubernetes") {
        return selectedContext();
      }
    }
    if (step() === 3) {
      if (provider() === "aws-ssm") return !!selectedParameter();
      if (provider() === "aws-secrets") return !!selectedSecret();
      if (provider() === "kubernetes") {
        return !!selectedKubeSecret() && !!selectedKey();
      }
    }
    if (step() === 4) {
      return !!parsedConnection() && !!connectionName();
    }
    return false;
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal cloud-import-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Import from Cloud</h2>
          <button class="modal-close-btn" onClick={() => props.onClose()}>
            <Icon svg={xSvg} size={18} />
          </button>
        </div>

        <div class="wizard-progress">
          <div class={`wizard-step ${step() >= 1 ? "active" : ""}`}>
            <span class="step-number">1</span>
            <span class="step-label">Provider</span>
          </div>
          <div class="wizard-connector" />
          <div class={`wizard-step ${step() >= 2 ? "active" : ""}`}>
            <span class="step-number">2</span>
            <span class="step-label">Configure</span>
          </div>
          <div class="wizard-connector" />
          <div class={`wizard-step ${step() >= 3 ? "active" : ""}`}>
            <span class="step-number">3</span>
            <span class="step-label">Select</span>
          </div>
          <div class="wizard-connector" />
          <div class={`wizard-step ${step() >= 4 ? "active" : ""}`}>
            <span class="step-number">4</span>
            <span class="step-label">Preview</span>
          </div>
        </div>

        <Show when={error()}>
          <div class="error">{error()}</div>
        </Show>

        <div class="wizard-content">
          {/* Step 1: Select Provider */}
          <Show when={step() === 1}>
            <div class="provider-selection">
              <p class="wizard-description">
                Select where to import your database connection from:
              </p>
              <div class="provider-options">
                <button
                  class={`provider-option ${provider() === "aws-ssm" ? "selected" : ""}`}
                  onClick={() => handleProviderSelect("aws-ssm")}
                  disabled={loading()}
                >
                  <div class="provider-icon">AWS</div>
                  <div class="provider-info">
                    <div class="provider-name">Parameter Store</div>
                    <div class="provider-desc">AWS Systems Manager</div>
                  </div>
                </button>
                <button
                  class={`provider-option ${provider() === "aws-secrets" ? "selected" : ""}`}
                  onClick={() => handleProviderSelect("aws-secrets")}
                  disabled={loading()}
                >
                  <div class="provider-icon">AWS</div>
                  <div class="provider-info">
                    <div class="provider-name">Secrets Manager</div>
                    <div class="provider-desc">AWS Secrets Manager</div>
                  </div>
                </button>
                <button
                  class={`provider-option ${provider() === "kubernetes" ? "selected" : ""}`}
                  onClick={() => handleProviderSelect("kubernetes")}
                  disabled={loading()}
                >
                  <div class="provider-icon">K8s</div>
                  <div class="provider-info">
                    <div class="provider-name">Kubernetes</div>
                    <div class="provider-desc">Kubernetes Secrets</div>
                  </div>
                </button>
              </div>
            </div>
          </Show>

          {/* Step 2: Configure Source */}
          <Show when={step() === 2}>
            <div class="source-configuration">
              <Show when={provider() === "aws-ssm" || provider() === "aws-secrets"}>
                <div class="form-group">
                  <label for="aws-profile">AWS Profile</label>
                  <select
                    id="aws-profile"
                    value={selectedProfile()}
                    onChange={(e) => setSelectedProfile(e.currentTarget.value)}
                  >
                    <For each={awsProfiles()}>
                      {(profile) => (
                        <option value={profile.name}>{profile.name}</option>
                      )}
                    </For>
                  </select>
                </div>
                <div class="form-group">
                  <label for="aws-region">Region</label>
                  <input
                    id="aws-region"
                    type="text"
                    value={region()}
                    onInput={(e) => setRegion(e.currentTarget.value)}
                    placeholder="us-east-1"
                  />
                </div>
                <Show when={provider() === "aws-ssm"}>
                  <div class="form-group">
                    <label for="path-prefix">Path Prefix (optional)</label>
                    <input
                      id="path-prefix"
                      type="text"
                      value={pathPrefix()}
                      onInput={(e) => setPathPrefix(e.currentTarget.value)}
                      placeholder="/database/"
                    />
                  </div>
                </Show>
              </Show>

              <Show when={provider() === "kubernetes"}>
                <div class="form-group">
                  <label for="kube-context">Context</label>
                  <select
                    id="kube-context"
                    value={selectedContext()}
                    onChange={(e) => setSelectedContext(e.currentTarget.value)}
                  >
                    <For each={kubeContexts()}>
                      {(ctx) => <option value={ctx.name}>{ctx.name}</option>}
                    </For>
                  </select>
                </div>
              </Show>
            </div>
          </Show>

          {/* Step 3: Select Secret */}
          <Show when={step() === 3}>
            <div class="secret-selection">
              <Show when={provider() === "kubernetes" && kubeNamespaces().length > 0}>
                <div class="form-group">
                  <label for="kube-namespace">Namespace</label>
                  <select
                    id="kube-namespace"
                    value={selectedNamespace()}
                    onChange={(e) => setSelectedNamespace(e.currentTarget.value)}
                  >
                    <For each={kubeNamespaces()}>
                      {(ns) => <option value={ns.name}>{ns.name}</option>}
                    </For>
                  </select>
                </div>
              </Show>

              <Show
                when={
                  ssmParameters().length > 0 ||
                  awsSecrets().length > 0 ||
                  kubeSecrets().length > 0
                }
              >
                <div class="form-group">
                  <label>Search</label>
                  <input
                    type="text"
                    value={searchFilter()}
                    onInput={(e) => setSearchFilter(e.currentTarget.value)}
                    placeholder="Filter secrets..."
                  />
                </div>
              </Show>

              <Show when={provider() === "aws-ssm"}>
                <div class="secret-list">
                  <Show when={loading()}>
                    <div class="history-loading">Loading parameters...</div>
                  </Show>
                  <Show when={!loading() && filteredSsmParameters().length === 0}>
                    <div class="history-empty">No parameters found</div>
                  </Show>
                  <For each={filteredSsmParameters()}>
                    {(param) => (
                      <button
                        class={`secret-item ${selectedParameter() === param.name ? "selected" : ""}`}
                        onClick={() => setSelectedParameter(param.name)}
                      >
                        <div class="secret-name">{param.name}</div>
                        <div class="secret-meta">{param.parameter_type}</div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={provider() === "aws-secrets"}>
                <div class="secret-list">
                  <Show when={loading()}>
                    <div class="history-loading">Loading secrets...</div>
                  </Show>
                  <Show when={!loading() && filteredAwsSecrets().length === 0}>
                    <div class="history-empty">No secrets found</div>
                  </Show>
                  <For each={filteredAwsSecrets()}>
                    {(secret) => (
                      <button
                        class={`secret-item ${selectedSecret() === secret.name ? "selected" : ""}`}
                        onClick={() => setSelectedSecret(secret.name)}
                      >
                        <div class="secret-name">{secret.name}</div>
                        <Show when={secret.description}>
                          <div class="secret-meta">{secret.description}</div>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={provider() === "kubernetes"}>
                <div class="secret-list">
                  <Show when={loading()}>
                    <div class="history-loading">Loading secrets...</div>
                  </Show>
                  <Show when={!loading() && filteredKubeSecrets().length === 0}>
                    <div class="history-empty">No secrets found</div>
                  </Show>
                  <For each={filteredKubeSecrets()}>
                    {(secret) => (
                      <button
                        class={`secret-item ${selectedKubeSecret() === secret.name ? "selected" : ""}`}
                        onClick={() => setSelectedKubeSecret(secret.name)}
                      >
                        <div class="secret-name">{secret.name}</div>
                        <div class="secret-meta">{secret.secret_type}</div>
                      </button>
                    )}
                  </For>
                </div>

                <Show when={selectedKubeSecret() && kubeSecretKeys().length > 0}>
                  <div class="form-group" style={{ "margin-top": "16px" }}>
                    <label for="secret-key">Secret Key</label>
                    <select
                      id="secret-key"
                      value={selectedKey()}
                      onChange={(e) => setSelectedKey(e.currentTarget.value)}
                    >
                      <For each={kubeSecretKeys()}>
                        {(key) => <option value={key.key}>{key.key}</option>}
                      </For>
                    </select>
                  </div>
                </Show>
              </Show>
            </div>
          </Show>

          {/* Step 4: Preview */}
          <Show when={step() === 4}>
            <div class="connection-preview">
              <Show when={parseError()}>
                <div class="error">{parseError()}</div>
              </Show>

              <Show when={parsedConnection()}>
                <div class="preview-fields">
                  <div class="form-group">
                    <label for="connection-name">Connection Name</label>
                    <input
                      id="connection-name"
                      type="text"
                      value={connectionName()}
                      onInput={(e) => setConnectionName(e.currentTarget.value)}
                      required
                    />
                  </div>

                  <div class="form-group">
                    <label for="category">Category</label>
                    <Show
                      when={props.categories.length > 0}
                      fallback={
                        <div class="category-hint">No categories available</div>
                      }
                    >
                      <select
                        id="category"
                        value={categoryId() || ""}
                        onChange={(e) =>
                          setCategoryId(e.currentTarget.value || null)
                        }
                      >
                        <option value="">None</option>
                        <For each={props.categories}>
                          {(cat) => <option value={cat.id}>{cat.name}</option>}
                        </For>
                      </select>
                    </Show>
                  </div>

                  <div class="preview-row">
                    <span class="preview-label">Type:</span>
                    <span class="preview-value">{parsedConnection()!.db_type}</span>
                  </div>
                  <div class="preview-row">
                    <span class="preview-label">Host:</span>
                    <span class="preview-value">{parsedConnection()!.host}</span>
                  </div>
                  <div class="preview-row">
                    <span class="preview-label">Port:</span>
                    <span class="preview-value">{parsedConnection()!.port}</span>
                  </div>
                  <div class="preview-row">
                    <span class="preview-label">Username:</span>
                    <span class="preview-value">{parsedConnection()!.username}</span>
                  </div>
                  <div class="preview-row">
                    <span class="preview-label">Password:</span>
                    <span class="preview-value">••••••••</span>
                  </div>
                  <Show when={parsedConnection()!.database}>
                    <div class="preview-row">
                      <span class="preview-label">Database:</span>
                      <span class="preview-value">
                        {parsedConnection()!.database}
                      </span>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        <div class="wizard-footer">
          <Show when={step() > 1}>
            <button class="btn-secondary" onClick={handleBack} disabled={loading()}>
              <Icon svg={arrowLeftSvg} size={16} />
              Back
            </button>
          </Show>
          <div class="wizard-footer-spacer" />
          <Show when={step() === 4 && parsedConnection()}>
            <button
              class="btn-primary"
              onClick={handleImport}
              disabled={loading() || !canProceed()}
            >
              <Icon svg={checkSvg} size={16} />
              {loading() ? "Importing..." : "Import"}
            </button>
          </Show>
          <Show when={step() >= 2 && step() < 4}>
            <button
              class="btn-primary"
              onClick={handleNext}
              disabled={loading() || !canProceed()}
            >
              {loading() ? "Loading..." : "Next"}
              <Icon svg={arrowRightSvg} size={16} />
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
