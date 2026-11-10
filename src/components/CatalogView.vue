<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ACTIVITY_TONES, MAX_ITEM_NAME_LENGTH } from '../catalog'
import type {
  ActivityDefinition, ActivityTone, CatalogChange, HabitDefinition, PlannerCatalog,
} from '../catalog'

const props = defineProps<{
  catalog: PlannerCatalog
  loading: boolean
  error: string
  mutationError: string
  busy: boolean
}>()

const emit = defineEmits<{
  save: [change: CatalogChange]
  retry: []
}>()

type Item = ActivityDefinition | HabitDefinition
type Kind = CatalogChange['kind']
type Editor = { kind: Kind; id?: string; name: string; tone: ActivityTone }

const sections = computed(() => [
  { kind: 'activity' as const, title: '活动类型', items: props.catalog.activities },
  { kind: 'habit' as const, title: '打卡项目', items: props.catalog.habits },
])
const editor = ref<Editor | null>(null)
const nameInputs = ref<HTMLInputElement[]>([])
const formError = ref('')
const unavailable = computed(() => props.busy || props.loading || Boolean(props.error))
let opener: HTMLButtonElement | null = null
const pendingSave = ref<{ change: CatalogChange; existing: Set<string> } | null>(null)

function itemsFor(kind: Kind) {
  return kind === 'activity' ? props.catalog.activities : props.catalog.habits
}

async function openEditor(kind: Kind, event: MouseEvent, item?: Item) {
  opener = event.currentTarget as HTMLButtonElement
  formError.value = ''
  editor.value = {
    kind,
    id: item?.id,
    name: item?.name ?? '',
    tone: item && 'tone' in item ? item.tone : 'purple',
  }
  await nextTick()
  nameInputs.value[0]?.focus()
}

async function closeEditor() {
  pendingSave.value = null
  editor.value = null
  await nextTick()
  opener?.focus()
  opener = null
}

function matches(item: Item, change: CatalogChange) {
  return item.name === change.name &&
    (change.kind === 'habit' || ('tone' in item && item.tone === change.tone))
}

function save() {
  const current = editor.value
  if (!current || unavailable.value) return
  const name = current.name.trim()
  const length = Array.from(name).length
  if (length < 1 || length > MAX_ITEM_NAME_LENGTH) {
    formError.value = `名称须为 1–${MAX_ITEM_NAME_LENGTH} 个字符。`
    return
  }
  formError.value = ''
  const change: CatalogChange = current.kind === 'activity'
    ? { kind: 'activity', id: current.id, name, tone: current.tone }
    : { kind: 'habit', id: current.id, name }
  const items = itemsFor(change.kind)
  if (items.some((item) => item.id === change.id && matches(item, change))) {
    void closeEditor()
    return
  }
  pendingSave.value = { change, existing: new Set(items.map((item) => item.id)) }
  emit('save', change)
}

watch([() => props.catalog.activities, () => props.catalog.habits, () => props.busy], () => {
  if (!pendingSave.value || props.busy || props.mutationError) return
  const { change, existing } = pendingSave.value
  if (itemsFor(change.kind).some((item) =>
    (change.id ? item.id === change.id : !existing.has(item.id)) && matches(item, change),
  )) void closeEditor()
})
</script>

<template>
  <section class="records-panel" aria-labelledby="catalog-heading">
    <header class="record-heading">
      <div>
        <h2 id="catalog-heading">项目配置</h2>
        <p class="catalog-note">日程和打卡按固定 ID 关联。改名后，历史记录会显示新名称。</p>
      </div>
    </header>

    <p v-if="loading" class="catalog-note" role="status">正在读取配置…</p>
    <div v-if="error" class="catalog-error">
      <p role="alert">{{ error }}</p>
      <button type="button" class="planner-button" :disabled="busy || loading" @click="emit('retry')">重试</button>
    </div>

    <div class="catalog-sections">
      <section
        v-for="section in sections"
        :key="section.kind"
        class="catalog-section"
        :aria-labelledby="'catalog-section-' + section.kind"
      >
        <header class="catalog-section-heading">
          <h3 :id="'catalog-section-' + section.kind">{{ section.title }}</h3>
          <button
            type="button"
            class="planner-button primary"
            :disabled="unavailable || Boolean(editor)"
            @click="openEditor(section.kind, $event)"
          >新增{{ section.title }}</button>
        </header>

        <form
          v-if="editor && editor.kind === section.kind"
          class="catalog-form"
          :aria-label="(editor.id ? '编辑' : '新增') + section.title"
          :aria-busy="busy"
          @submit.prevent="save"
        >
          <label class="record-field">
            <span>名称</span>
            <input ref="nameInputs" v-model="editor.name" type="text" required :disabled="busy">
          </label>
          <label v-if="editor.kind === 'activity'" class="record-field">
            <span>
              日历颜色
              <span class="catalog-tone-preview" :class="'tone-' + editor.tone" aria-hidden="true"></span>
            </span>
            <select v-model="editor.tone" :disabled="busy">
              <option v-for="(label, tone) in ACTIVITY_TONES" :key="tone" :value="tone">{{ label }}</option>
            </select>
          </label>
          <p v-if="editor.id" class="catalog-id"><span>ID</span> <code>{{ editor.id }}</code></p>
          <p v-if="formError || (pendingSave && mutationError)" class="catalog-error" role="alert">
            {{ formError || mutationError }}
          </p>
          <div class="catalog-actions">
            <button type="button" class="planner-button" :disabled="busy" @click="closeEditor">取消</button>
            <button type="submit" class="planner-button primary" :disabled="unavailable">
              {{ busy ? '保存中…' : '保存' }}
            </button>
          </div>
        </form>

        <p v-if="!section.items.length && !loading" class="catalog-note">暂无{{ section.title }}。</p>
        <ul v-else class="catalog-list">
          <li v-for="item in section.items" :key="item.id" class="catalog-item">
            <div class="catalog-item-body">
              <p class="catalog-name">
                <span v-if="'tone' in item" class="tone-dot" :class="'tone-' + item.tone" aria-hidden="true"></span>
                {{ item.name }}
              </p>
              <p class="catalog-id"><span>ID</span> <code>{{ item.id }}</code></p>
              <p v-if="'startDate' in item && item.startDate !== '0001-01-01'" class="catalog-note">
                从 <time :datetime="item.startDate">{{ item.startDate }}</time> 起打卡
              </p>
            </div>
            <button
              type="button"
              class="planner-button"
              :disabled="unavailable || Boolean(editor)"
              :aria-label="'编辑' + section.title + ' ' + item.name"
              @click="openEditor(section.kind, $event, item)"
            >编辑</button>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.catalog-note,
.catalog-id {
  color: var(--dp-sub);
  font-size: 12px;
}

.catalog-id {
  overflow-wrap: anywhere;
}

.catalog-error {
  color: var(--dp-danger);
}

.catalog-error button {
  margin-block: 6px;
}

.catalog-sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 12px;
}

.catalog-section,
.catalog-form {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--dp-line);
  border-radius: 10px;
}

.catalog-section-heading,
.catalog-item,
.catalog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.catalog-form {
  background: var(--dp-bg);
}

.catalog-actions {
  justify-content: flex-end;
}

.catalog-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.catalog-item {
  min-width: 0;
  padding-block: 8px;
  border-top: 1px solid var(--dp-line);
}

.catalog-item-body {
  min-width: 0;
  overflow-wrap: anywhere;
}

.catalog-name {
  font-weight: 620;
}

.catalog-name .tone-dot {
  margin-inline-end: 3px;
}

.catalog-tone-preview {
  display: inline-block;
  width: 18px;
  height: 11px;
  margin-inline-start: 4px;
  vertical-align: -1px;
  border-inline-start: 2px solid var(--activity-ink);
  border-radius: 3px;
  background: var(--activity-bg);
}

@media (max-width: 650px) {
  .catalog-sections {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
