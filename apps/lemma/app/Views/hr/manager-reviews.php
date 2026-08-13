<?php
$statuses = \App\Services\PerformanceReviewService::REVIEW_STATUSES;
$ready = array_values(array_filter($reviews, static fn (array $review): bool => ($review['manager_state'] ?? '') === 'ready'));
$waiting = array_values(array_filter($reviews, static fn (array $review): bool => ($review['manager_state'] ?? '') === 'waiting'));
$done = array_values(array_filter($reviews, static fn (array $review): bool => ($review['manager_state'] ?? '') === 'done'));
?>

<section class="project-head project-head--tab performance-review-head">
    <div>
        <span class="muted">Личная очередь руководителя</span>
        <h2>Моя очередь</h2>
        <p>Здесь только сотрудники, для которых вы назначены оценивающим руководителем.</p>
    </div>
    <div class="toolbar__actions project-tab-actions">
        <a class="btn btn-outline" href="<?= url('/profile#performance-review') ?>">Мой профиль</a>
    </div>
</section>

<section class="review-inbox-summary" aria-label="Сводка очереди оценок">
    <article class="review-inbox-summary__focus"><span>Можно оценивать сейчас</span><strong><?= count($ready) ?></strong><small>Самооценка сотрудника завершена и скрыта до вашей отправки.</small></article>
    <article><span>Ожидают сотрудника</span><strong><?= count($waiting) ?></strong><small>У вас пока нет действия.</small></article>
    <article><span>Ваша оценка отправлена</span><strong><?= count($done) ?></strong><small>Результаты доступны по правилам этапа.</small></article>
</section>

<section class="panel review-inbox">
    <div class="panel__head"><div><h2>Требуют вашего действия</h2><span class="muted">Открываются только после завершения самооценки сотрудника</span></div><span class="pill"><?= count($ready) ?></span></div>
    <div class="review-inbox-list">
        <?php foreach ($ready as $review): ?>
            <article class="review-inbox-card review-inbox-card--ready">
                <div><span class="review-inbox-state">Можно оценивать</span><h3><?= e($review['employee_name']) ?></h3><p><?= e($review['employee_department'] ?: 'без отдела') ?> · <?= e($review['cycle_title']) ?></p></div>
                <div class="review-inbox-card__meta"><span>Срок</span><strong><?= e(!empty($review['response_deadline']) ? format_date((string) $review['response_deadline']) : 'не указан') ?></strong></div>
                <a class="btn btn--red" href="<?= url('/performance-review/' . (int) $review['id']) ?>">Оценить сотрудника</a>
            </article>
        <?php endforeach; ?>
        <?php if ($ready === []): ?><p class="review-inbox-empty">Сейчас нет оценок, требующих вашего действия.</p><?php endif; ?>
    </div>
</section>

<?php if ($waiting !== []): ?>
<details class="panel review-inbox-fold">
    <summary><strong>Ожидают сотрудника</strong><span><?= count($waiting) ?></span></summary>
    <div class="review-inbox-list">
        <?php foreach ($waiting as $review): ?>
            <article class="review-inbox-card">
                <div><span class="review-inbox-state review-inbox-state--waiting">Действий пока нет</span><h3><?= e($review['employee_name']) ?></h3><p><?= e($review['cycle_title']) ?></p></div>
                <a class="btn btn-outline" href="<?= url('/profiles/' . (int) $review['user_id'] . '#performance-review') ?>">Профиль сотрудника</a>
            </article>
        <?php endforeach; ?>
    </div>
</details>
<?php endif; ?>

<?php if ($done !== []): ?>
<details class="panel review-inbox-fold">
    <summary><strong>Отправленные оценки</strong><span><?= count($done) ?></span></summary>
    <div class="review-inbox-list">
        <?php foreach ($done as $review): ?>
            <article class="review-inbox-card">
                <div><span class="review-inbox-state review-inbox-state--done">Оценка отправлена</span><h3><?= e($review['employee_name']) ?></h3><p><?= e($statuses[$review['status']] ?? $review['status']) ?> · <?= e($review['cycle_title']) ?></p></div>
                <a class="btn btn-outline" href="<?= url('/performance-review/' . (int) $review['id']) ?>">Открыть</a>
            </article>
        <?php endforeach; ?>
    </div>
</details>
<?php endif; ?>
