<?php
$projectId = (int) $project['id'];
$selectedIds = static fn (array $rows): array => array_map(static fn (array $row): int => (int) $row['user_id'], $rows);
$assignableUsers = array_values(array_filter($users, static fn (array $person): bool => (int) ($person['is_active'] ?? 1) === 1 && (string) ($person['role'] ?? '') !== 'admin'));
$tableRows = [];
$completeCount = 0;
$teamUserIds = [];
foreach ($structure as $stage) {
    foreach ($stage['sections'] as $section) {
        $section['stage_code'] = (string) ($stage['code'] ?? '');
        $section['stage_title'] = (string) ($stage['title'] ?? '');
        $tableRows[] = $section;
        $executorIds = $selectedIds($section['executors']);
        $reviewerIds = $selectedIds($section['reviewers']);
        $teamUserIds = [...$teamUserIds, ...$executorIds, ...$reviewerIds];
        if ($executorIds !== [] && $reviewerIds !== []) $completeCount++;
    }
}
$teamUserIds = array_values(array_unique($teamUserIds));
$catalogOptions = [];
foreach ([...$catalog['templates']['pp87'], ...$catalog['templates']['rd'], ...$catalog['sections'], ...$catalog['activities']] as $option) {
    $code = trim((string) ($option['value'] ?? ''));
    if ($code !== '') $catalogOptions[$code] = (string) ($option['label'] ?? $code);
}
ksort($catalogOptions, SORT_NATURAL);
$peopleSummary = static function (array $rows): string {
    if ($rows === []) return 'Не выбраны';
    $names = array_map(static fn (array $row): string => (string) ($row['name'] ?? ''), $rows);
    return count($names) <= 2 ? implode(', ', $names) : implode(', ', array_slice($names, 0, 2)) . ' +' . (count($names) - 2);
};
$renderPeopleField = static function (string $role, int $sectionId, array $assignedRows, array $assignableUsers): void {
    $inputName = $sectionId > 0 ? $role . '_ids[' . $sectionId . '][]' : 'new_' . $role . '_ids[]';
    $label = $role === 'executor' ? 'Кто делает' : 'Кто проверяет';
    $selected = array_fill_keys(array_map(static fn (array $row): int => (int) ($row['user_id'] ?? 0), $assignedRows), true);
    ?>
    <div class="project-team-people-field" data-project-people-field data-project-people-name="<?= e($inputName) ?>">
        <div class="project-team-people-field__selected" data-project-people-selected>
            <?php foreach ($assignedRows as $assigned): ?><?php $userId = (int) ($assigned['user_id'] ?? 0); ?>
                <span class="project-team-person-chip" data-project-person-chip data-user-id="<?= $userId ?>">
                    <span><?= e($assigned['name'] ?? '') ?></span>
                    <button type="button" data-project-person-remove aria-label="Убрать сотрудника <?= e($assigned['name'] ?? '') ?>">&times;</button>
                    <input type="hidden" name="<?= e($inputName) ?>" value="<?= $userId ?>">
                </span>
            <?php endforeach; ?>
        </div>
        <label class="project-team-people-field__add">
            <span class="sr-only"><?= e($label) ?></span>
            <select data-project-people-add aria-label="<?= e($label) ?>">
                <option value="">Найти сотрудника</option>
                <?php foreach ($assignableUsers as $person): ?><?php $userId = (int) $person['id']; ?>
                    <option value="<?= $userId ?>" data-person-name="<?= e($person['name']) ?>" data-person-department="<?= e($person['department'] ?: 'Без отдела') ?>"<?= isset($selected[$userId]) ? ' hidden' : '' ?>><?= e($person['name'] . ' · ' . ($person['department'] ?: 'Без отдела')) ?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <span class="project-team-people-field__empty" data-project-people-empty<?= $assignedRows !== [] ? ' hidden' : '' ?>>Не назначен</span>
    </div>
    <?php
};
?>
<div class="topbar">
    <div class="topbar__meta"><span><?= e($project['code']) ?></span><h1>Структура и команда</h1><p>Разделы проекта, исполнители и проверяющие — в одной таблице.</p></div>
    <div class="topbar__actions"><a class="btn btn-outline" href="<?= url('/projects/' . $projectId) ?>">К проекту</a><a class="btn btn--red" href="<?= url('/projects/' . $projectId . '/health-report') ?>">Что у нас плохого</a></div>
</div>
<?php $projectNavActive = 'structure'; require BASE_PATH . '/app/Views/projects/_navigation.php'; ?>

<section class="panel project-team-table-panel" id="project-team-table">
    <div class="panel__head">
        <div><h2>Команда по разделам</h2><span>Выберите раздел, проверьте его код и назначьте тех, кто делает и проверяет.</span></div>
        <div class="project-team-table-stats"><strong><?= count($teamUserIds) ?></strong><span>чел.</span><strong><?= $completeCount ?> / <?= count($tableRows) ?></strong><span>укомплектовано</span></div>
    </div>

    <form method="post" action="<?= url('/projects/' . $projectId . '/structure/assignments') ?>" class="project-team-assignment-table-form" data-project-section-add-form>
        <?= csrf_field() ?>
        <div class="project-team-table-toolbar">
            <label><span>Найти в таблице</span><input type="search" placeholder="Раздел, код или сотрудник" data-project-structure-filter autocomplete="off"></label>
            <span><strong data-project-structure-count><?= count($tableRows) ?></strong> разделов</span>
            <?php if ($canEdit && !$isArchived): ?>
                <div class="project-team-table-toolbar__actions">
                    <button class="btn btn-outline" type="button" data-project-section-add-start>+ Добавить раздел</button>
                    <?php if ($tableRows !== []): ?><button class="btn btn--red" type="submit">Сохранить таблицу</button><?php endif; ?>
                </div>
            <?php endif; ?>
        </div>
        <div class="table-wrap project-team-table-wrap">
            <table class="data-table project-team-assignment-table" data-no-column-filters>
                <thead><tr><th>Раздел</th><th>Код</th><th>Кто делает</th><th>Кто проверяет</th><th>Действия</th></tr></thead>
                <tbody>
                <?php if ($canEdit && !$isArchived): ?>
                    <tr class="project-team-draft-row" data-project-section-draft hidden>
                        <td data-label="Раздел">
                            <label class="project-team-draft-control"><span>Раздел из справочника или свой</span><select name="catalog_code" data-project-section-catalog aria-label="Раздел из справочника или свой"><option value="">Свой раздел</option><?php foreach ($catalogOptions as $code => $label): ?><option value="<?= e($code) ?>" data-project-section-option-code="<?= e($code) ?>" data-project-section-option-title="<?= e($label) ?>"><?= e($code . ' · ' . $label) ?></option><?php endforeach; ?></select></label>
                            <label class="project-team-draft-control" data-project-section-title-field><span>Название своего раздела</span><input name="title" maxlength="255" placeholder="Наружные сети водоснабжения" data-project-section-title></label>
                            <input type="hidden" name="work_kind" value="section">
                            <input type="hidden" name="save_to_catalog" value="1">
                        </td>
                        <td data-label="Код"><label class="project-team-draft-control"><span>Код</span><input name="code" maxlength="120" placeholder="НВК" data-project-section-code></label></td>
                        <td data-label="Кто делает"><?php $renderPeopleField('executor', 0, [], $assignableUsers); ?></td>
                        <td data-label="Кто проверяет"><?php $renderPeopleField('reviewer', 0, [], $assignableUsers); ?></td>
                        <td class="project-team-row-actions" data-label="Действия"><button class="btn btn--red btn-sm" type="submit" formaction="<?= url('/projects/' . $projectId . '/structure/items') ?>">Добавить</button><button class="btn btn-outline btn-sm" type="button" data-project-section-add-cancel>Отменить</button></td>
                    </tr>
                <?php endif; ?>
                <?php foreach ($tableRows as $section): ?>
                    <?php
                    $sectionId = (int) $section['id'];
                    $executorIds = $selectedIds($section['executors']);
                    $reviewerIds = $selectedIds($section['reviewers']);
                    $isComplete = $executorIds !== [] && $reviewerIds !== [];
                    $peopleText = implode(' ', array_map(static fn (array $row): string => (string) ($row['name'] ?? ''), [...$section['executors'], ...$section['reviewers']]));
                    $searchText = mb_strtolower(trim((string) ($section['stage_code'] ?? '') . ' ' . (string) ($section['stage_title'] ?? '') . ' ' . (string) ($section['code'] ?? '') . ' ' . (string) ($section['title'] ?? '') . ' ' . $peopleText), 'UTF-8');
                    $groupLabel = $section['stage_code'] ?: ((string) ($section['work_kind'] ?? '') === 'activity' ? 'Общий раздел' : 'Без стадии');
                    ?>
                    <tr data-project-structure-row data-project-structure-search="<?= e($searchText) ?>">
                        <td class="project-team-section-cell" data-label="Раздел"><input type="hidden" name="section_ids[]" value="<?= $sectionId ?>"><strong><?= e($section['title'] ?: $section['code'] ?: 'Без названия') ?></strong><small><?= e($groupLabel . (($section['stage_title'] ?? '') !== '' ? ' · ' . $section['stage_title'] : '')) ?></small></td>
                        <td class="project-team-code-cell" data-label="Код"><strong><?= e($section['code'] ?: '—') ?></strong><span class="project-team-table-status <?= $isComplete ? 'is-complete' : 'is-warning' ?>"><i aria-hidden="true"></i><?= $isComplete ? 'Готово' : 'Нужно назначить' ?></span></td>
                        <?php foreach (['executor' => $section['executors'], 'reviewer' => $section['reviewers']] as $role => $assignedRows): ?>
                            <td class="project-team-people-cell" data-label="<?= $role === 'executor' ? 'Кто делает' : 'Кто проверяет' ?>"><?php if ($canEdit && !$isArchived): ?><?php $renderPeopleField($role, $sectionId, $assignedRows, $assignableUsers); ?><?php else: ?><span><?= e($peopleSummary($assignedRows)) ?></span><?php endif; ?></td>
                        <?php endforeach; ?>
                        <td class="project-team-row-actions" data-label="Действия"><a class="btn btn-outline btn-sm" href="<?= url('/tasks/new?project_id=' . $projectId . '&project_section_id=' . $sectionId) ?>">+ Задача</a></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <div class="empty-state" data-project-structure-empty<?= $tableRows !== [] ? ' hidden' : '' ?>><strong><?= $tableRows === [] ? 'Разделов пока нет' : 'Ничего не найдено' ?></strong><p><?= $tableRows === [] ? 'Заполните новую строку в таблице.' : 'Измените поиск по разделу, коду или сотруднику.' ?></p></div>
        </div>
    </form>
</section>

<?php if ($canEdit && !$isArchived): ?>
<details class="panel project-structure-service-settings">
    <summary class="panel__head"><div><h2>Стадии проекта</h2><span>Дополнительная группировка разделов. BIM/ТИМ добавляется в общей таблице как раздел.</span></div><span class="details-toggle-label" aria-hidden="true"><span class="details-toggle-label__closed">Развернуть</span><span class="details-toggle-label__open">Свернуть</span></span></summary>
    <div class="project-structure-add-grid">
        <form class="form-stack" method="post" action="<?= url('/projects/' . $projectId . '/structure/stages') ?>"><?= csrf_field() ?><h3>Новая стадия</h3><label><span>Код</span><input name="code" maxlength="120" placeholder="РД" required></label><label><span>Название</span><input name="title" maxlength="255" placeholder="Рабочая документация"></label><label class="check-row"><input type="checkbox" name="save_to_catalog" value="1" checked><span>Сохранить в общий справочник</span></label><button class="btn btn-outline" type="submit">Добавить стадию</button></form>
    </div>
</details>
<?php endif; ?>
