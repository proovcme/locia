import {
  BookOpen,
  Calculator,
  CircleAlert,
  Download,
  FileCheck2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import type { SbcResult } from "../domain/types";
import {
  buildPirSummaryRows,
  calculatePirLabor,
  calculatePirTravel,
  createPirLaborParticipant,
  createPirLaborWork,
  createPirTravelTrip,
  qualificationsForWork,
  workKindLabel,
  type PirEstimatePassport,
  type PirLaborInput,
  type PirLaborWork,
  type PirSummaryExtra,
  type PirTravelInput,
  type PirTravelTrip,
  type PirWorkKind,
} from "../domain/pirForms";

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

function numericValue(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function PirPassportFields({
  value,
  onChange,
}: {
  value: PirEstimatePassport;
  onChange: (patch: Partial<PirEstimatePassport>) => void;
}) {
  return (
    <details className="pir-passport-editor" open>
      <summary>
        <span>Данные для печатных форм</span>
        <small>Общие для 2П, 3П и 4П</small>
      </summary>
      <div className="pir-passport-grid">
        <label className="field pir-span-2">
          <span>Наименование стройки</span>
          <input value={value.constructionName} onChange={(event) => onChange({ constructionName: event.target.value })} placeholder="Например: Жилой дом по адресу…" />
        </label>
        <label className="field">
          <span>Заказчик</span>
          <input value={value.customer} onChange={(event) => onChange({ customer: event.target.value })} placeholder="Наименование организации" />
        </label>
        <label className="field">
          <span>Проектная организация</span>
          <input value={value.designOrganization} onChange={(event) => onChange({ designOrganization: event.target.value })} placeholder="Наименование организации" />
        </label>
        <label className="field">
          <span>Генеральный проектировщик</span>
          <input value={value.generalDesigner} onChange={(event) => onChange({ generalDesigner: event.target.value })} placeholder="Если отличается" />
        </label>
        <label className="field">
          <span>Уровень цен</span>
          <div className="pir-period-fields">
            <select aria-label="Квартал уровня цен" value={value.priceLevelQuarter} onChange={(event) => onChange({ priceLevelQuarter: numericValue(event.target.value) })}>
              <option value={1}>I квартал</option><option value={2}>II квартал</option><option value={3}>III квартал</option><option value={4}>IV квартал</option>
            </select>
            <input aria-label="Год уровня цен" type="number" min="2000" max="2100" value={value.priceLevelYear || ""} onChange={(event) => onChange({ priceLevelYear: numericValue(event.target.value) })} />
          </div>
        </label>
        <label className="field">
          <span>Номер сметы 2П</span>
          <input value={value.estimate2pNumber} onChange={(event) => onChange({ estimate2pNumber: event.target.value })} />
        </label>
        <label className="field">
          <span>Номер калькуляции 3П</span>
          <input value={value.estimate3pNumber} onChange={(event) => onChange({ estimate3pNumber: event.target.value })} />
        </label>
        <label className="field">
          <span>Номер расчёта 4П</span>
          <input value={value.estimate4pNumber} onChange={(event) => onChange({ estimate4pNumber: event.target.value })} />
        </label>
      </div>
    </details>
  );
}

function LaborWorkCard({
  work,
  index,
  input,
  onChange,
  onRemove,
}: {
  work: PirLaborWork;
  index: number;
  input: PirLaborInput;
  onChange: (work: PirLaborWork) => void;
  onRemove: () => void;
}) {
  const result = calculatePirLabor({ ...input, works: [work] }).works[0];
  const qualifications = qualificationsForWork(work.kind);
  const salaryCode = work.kind === "ordinary" ? "71.11" : "71.12";

  function changeKind(kind: PirWorkKind) {
    const allowed = qualificationsForWork(kind);
    onChange({
      ...work,
      kind,
      participants: work.participants.map((participant) => ({
        ...participant,
        qualificationId: allowed.some((item) => item.id === participant.qualificationId)
          ? participant.qualificationId
          : allowed[Math.min(allowed.length - 1, 3)].id,
      })),
    });
  }

  return (
    <article className="pir-labor-work">
      <div className="pir-labor-work-heading">
        <div>
          <span className="fgis-kicker">Калькуляция 3П · {index + 1}</span>
          <h4>{work.name || "Новая работа"}</h4>
        </div>
        <div className="pir-work-total">
          <span>Без НДС</span>
          <strong>{money.format(result.costWithoutVat)}</strong>
          <button className="pir-icon-button" onClick={onRemove} aria-label="Удалить работу" title="Удалить работу"><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="pir-work-fields">
        <label className="field pir-span-2">
          <span>Наименование проектной работы</span>
          <input value={work.name} onChange={(event) => onChange({ ...work, name: event.target.value })} placeholder="Например: разработка раздела ООС" />
        </label>
        <label className="field">
          <span>Стадия</span>
          <select value={work.stage} onChange={(event) => onChange({ ...work, stage: event.target.value })}>
            <option value="П">Проектная документация (П)</option>
            <option value="Р">Рабочая документация (Р)</option>
            <option value="П+Р">Проектная и рабочая (П+Р)</option>
            <option value="Дополнительные работы">Дополнительные работы</option>
            <option value="Сопутствующие работы">Сопутствующие работы</option>
          </select>
        </label>
        <label className="field">
          <span>Характер работы</span>
          <select value={work.kind} onChange={(event) => changeKind(event.target.value as PirWorkKind)}>
            <option value="ordinary">Обычная документация</option>
            <option value="special">Особо опасный / сложный / уникальный объект</option>
            <option value="bim">Информационная модель</option>
          </select>
          <small className="field-hint">{work.kind === "ordinary" ? "ОКВЭД 71.11, таблица 1.3" : work.kind === "special" ? "ОКВЭД 71.12, таблица 1.3" : "ОКВЭД 71.12, таблица 1.4"}</small>
        </label>
        <label className="field">
          <span>Плановая продолжительность</span>
          <div className="pir-number-affix"><input type="number" min="0" step="0.01" value={work.plannedDurationDays || ""} onChange={(event) => onChange({ ...work, plannedDurationDays: numericValue(event.target.value) })} /><b>дней</b></div>
          <small className="field-hint">Срок выполнения именно этой работы.</small>
        </label>
        <label className="field pir-span-2">
          <span>Основание трудозатрат</span>
          <input value={work.basis} onChange={(event) => onChange({ ...work, basis: event.target.value })} placeholder="Календарный план, данные аналога, опрос организаций или технологическая карта" />
          <small className="field-hint">Дни и состав команды должны иметь проверяемое основание, а не назначаться произвольно.</small>
        </label>
      </div>

      <div className="pir-labor-table-scroll">
        <table className="pir-labor-table">
          <thead><tr><th>Исполнитель</th><th>Индекс</th><th>Участие, дней</th><th>Количество</th><th>Взвешенные чел.-дни</th><th></th></tr></thead>
          <tbody>
            {result.participants.map((participant) => (
              <tr key={participant.id}>
                <td>
                  <select value={participant.qualificationId} onChange={(event) => onChange({
                    ...work,
                    participants: work.participants.map((item) => item.id === participant.id ? { ...item, qualificationId: event.target.value } : item),
                  })}>
                    {qualifications.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                  {participant.qualification.equivalentTitle ? <small className="pir-qualification-note">В этой же строке таблицы {participant.qualification.table}: {participant.qualification.equivalentTitle}</small> : null}
                </td>
                <td><b>{number.format(participant.qualification.index)}</b><small>табл. {participant.qualification.table}</small></td>
                <td><input aria-label={`Дни участия: ${participant.qualification.title}`} type="number" min="0" max={work.plannedDurationDays || undefined} step="0.01" value={participant.actualDays || ""} onChange={(event) => onChange({
                  ...work,
                  participants: work.participants.map((item) => item.id === participant.id ? { ...item, actualDays: numericValue(event.target.value) } : item),
                })} /></td>
                <td><input aria-label={`Количество исполнителей: ${participant.qualification.title}`} type="number" min="0" step="1" value={participant.headcount || ""} onChange={(event) => onChange({
                  ...work,
                  participants: work.participants.map((item) => item.id === participant.id ? { ...item, headcount: numericValue(event.target.value) } : item),
                })} /></td>
                <td><strong>{number.format(participant.weightedPersonDays)}</strong></td>
                <td><button className="pir-icon-button" onClick={() => onChange({ ...work, participants: work.participants.filter((item) => item.id !== participant.id) })} aria-label="Удалить исполнителя"><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th>Итого по работе</th><td>Ккв-уч {number.format(result.qualificationParticipationCoefficient)}</td><td></td><td>{number.format(result.totalHeadcount)} чел.</td><td>{number.format(result.weightedPersonDays)}</td><td></td></tr></tfoot>
        </table>
      </div>
      <div className="pir-cost-chain" aria-label="Как рассчитана стоимость работы">
        <div><small>Средняя зарплата</small><b>{money.format(result.monthlySalary)}</b><span>ОКВЭД {salaryCode}, за месяц</span></div>
        <div><small>За рабочий день</small><b>{money.format(result.averageDailySalary)}</b><span>зарплата ÷ {number.format(input.averageWorkingDaysPerMonth)} дня</span></div>
        <div><small>Дневная выработка</small><b>{money.format(result.averageDailyOutput)}</b><span>полная стоимость дня с рентабельностью</span></div>
        <div><small>Участие команды</small><b>{number.format(result.weightedPersonDays)}</b><span>дни × люди × индекс квалификации</span></div>
          <div className="pir-cost-chain-total"><small>Стоимость в целевом квартале</small><b>{money.format(result.costWithoutVat)}</b><span>{money.format(result.baseCostWithoutVat)} × индекс {number.format(input.priceIndex)}</span></div>
      </div>
      <div className="pir-work-footer">
        <button className="ghost" onClick={() => onChange({ ...work, participants: [...work.participants, createPirLaborParticipant(work.kind)] })}><Plus size={16} /> Добавить исполнителя</button>
        {result.warnings.length ? <span className="pir-work-warning"><CircleAlert size={15} /> {result.warnings[0]}{result.warnings.length > 1 ? ` Ещё: ${result.warnings.length - 1}.` : ""}</span> : <span className="pir-work-valid"><FileCheck2 size={15} /> Данные для расчёта заполнены</span>}
      </div>
    </article>
  );
}

export function PirLaborCalculator({
  input,
  onChange,
  exporting,
  onExport,
}: {
  input: PirLaborInput;
  onChange: (value: PirLaborInput) => void;
  exporting: boolean;
  onExport: () => void;
}) {
  const result = calculatePirLabor(input);
  const patch = (value: Partial<PirLaborInput>) => onChange({ ...input, ...value });

  return (
    <section className="pir-707-calculator">
      <div className="pir-form-intro">
        <div><span className="fgis-kicker">ФОРМА 3П · ПРИКАЗ № 707/ПР</span><h2>Расчёт стоимости по трудозатратам</h2><p>Для работ, стоимость которых обосновывается составом исполнителей и продолжительностью их участия.</p></div>
        <div className="pir-form-badge"><Users size={20} /><span><b>{number.format(result.totalWeightedPersonDays)}</b> взвешенных чел.-дней</span></div>
      </div>

      <div className="fgis-purpose pir-purpose-compact">
        <BookOpen size={22} />
        <div><h3>Что считает форма 3П</h3><p>Стоимость проектной работы через среднюю дневную выработку и квалификационное участие команды. Это сметная калькуляция по Методике № 707/пр, а не коммерческий расчёт по внутренним окладам вашей организации.</p></div>
      </div>

      <details className="fgis-user-guide" open>
        <summary><span>Как заполнить расчёт</span><small>Пять шагов</small></summary>
        <ol>
          <li><b>Введите официальную среднюю зарплату.</b> Для обычной документации — ОКВЭД 71.11; для особых объектов и информационной модели — 71.12.</li>
          <li><b>Укажите рабочие дни.</b> Среднее за предшествующий год по производственному календарю.</li>
          <li><b>Добавьте работы и исполнителей.</b> Для каждой должности укажите фактические дни участия и количество специалистов.</li>
          <li><b>Запишите основание.</b> Календарный план, аналог, технологическая карта или подтверждённые данные организаций.</li>
          <li><b>Укажите индекс пересчёта.</b> Он переводит результат из уровня цен исходной зарплаты в квартал составления сметы.</li>
        </ol>
      </details>

      <div className="pir-labor-settings">
        <div className="pir-settings-heading"><span className="fgis-step-number">01</span><div><h3>Исходные данные о средней зарплате</h3><p>Это единая статистическая база для расчёта, а не оклады выбранных ниже сотрудников.</p></div></div>
        <div className="pir-salary-explanation">
          <div><b>Что нужно взять</b><span>Среднюю номинальную начисленную зарплату по России за январь–декабрь года, предшествующего составлению сметы.</span></div>
          <div><b>Какой ОКВЭД выбрать</b><span>71.11 — обычные проектные работы. 71.12 — особо опасные, технически сложные, уникальные объекты и информационная модель.</span></div>
          <div><b>Как она применяется</b><span>Зарплата переводится в стоимость рабочего дня. Список исполнителей затем учитывает дни, количество людей и индекс квалификации.</span></div>
          <a href="https://www.rosstat.gov.ru/labor_market_employment_salaries" target="_blank" rel="noreferrer">Открыть официальный раздел Росстата</a>
        </div>
        <div className="pir-settings-grid">
          <label className="field"><span>Год данных</span><input type="number" min="2000" max="2100" value={input.sourceYear || ""} onChange={(event) => patch({ sourceYear: numericValue(event.target.value) })} /></label>
          <label className="field"><span>Рабочих дней в месяце, в среднем</span><input type="number" min="0" step="0.01" value={input.averageWorkingDaysPerMonth || ""} onChange={(event) => patch({ averageWorkingDaysPerMonth: numericValue(event.target.value) })} /></label>
          <label className="field"><span>Средняя зарплата · ОКВЭД 71.11</span><div className="pir-number-affix"><input type="number" min="0" step="100" value={input.ordinaryMonthlySalary || ""} onChange={(event) => patch({ ordinaryMonthlySalary: numericValue(event.target.value) })} /><b>₽/мес.</b></div><small className="field-hint">Архитектурная деятельность.</small></label>
          <label className="field"><span>Средняя зарплата · ОКВЭД 71.12</span><div className="pir-number-affix"><input type="number" min="0" step="100" value={input.specialMonthlySalary || ""} onChange={(event) => patch({ specialMonthlySalary: numericValue(event.target.value) })} /><b>₽/мес.</b></div><small className="field-hint">Инженерно-техническое проектирование.</small></label>
          <label className="field pir-span-2"><span>Источник значения</span><input value={input.salarySource} onChange={(event) => patch({ salarySource: event.target.value })} placeholder="Например: Росстат, таблица зарплаты по видам деятельности за 2025 год" /><small className="field-hint">Запишите название таблицы, год и ссылку — эти данные попадут в XLSX.</small></label>
          <label className="field"><span>Индекс пересчёта в целевой квартал</span><input type="number" min="0" step="0.001" value={input.priceIndex || ""} onChange={(event) => patch({ priceIndex: numericValue(event.target.value) })} /><small className="field-hint">Если уровни цен совпадают, укажите 1.</small></label>
          <label className="field"><span>Источник индекса</span><input value={input.priceIndexSource} onChange={(event) => patch({ priceIndexSource: event.target.value })} placeholder="Письмо Минстроя России, номер и дата" /><small className="field-hint">Индекс изменения сметной стоимости проектных работ.</small></label>
        </div>
        <div className="pir-fixed-rules">
          <span><b>40%</b> доля зарплаты в себестоимости, Кз = 0,4</span>
          <span><b>10%</b> нормативная рентабельность, Р = 0,1</span>
          <span><b>Ипр</b> перевод в целевой квартал по письму Минстроя</span>
        </div>
      </div>

      <div className="pir-labor-list-heading"><div><span className="fgis-step-number">02</span><div><h3>Работы и состав исполнителей</h3><p>Каждая самостоятельная работа формирует отдельную калькуляцию 3П. В свод проекта она включается только по вашему выбору.</p></div></div><button className="primary" onClick={() => patch({ works: [...input.works, createPirLaborWork()] })}><Plus size={17} /> Добавить работу</button></div>
      <div className="pir-role-note"><b>Почему нет отдельных «научных сотрудников»</b><span>Методика приводит их как альтернативные названия в тех же строках таблицы 1.3. Для обычного проекта выбирайте привычную проектную должность — соответствующий индекс уже тот же.</span></div>
      <div className="pir-labor-list">
        {input.works.map((work, index) => <LaborWorkCard key={work.id} work={work} index={index} input={input} onChange={(next) => patch({ works: input.works.map((item) => item.id === work.id ? next : item) })} onRemove={() => patch({ works: input.works.filter((item) => item.id !== work.id) })} />)}
        {!input.works.length ? <div className="pir-empty-list"><Users size={26} /><b>Работы ещё не добавлены</b><span>Добавьте работу, затем укажите исполнителей и дни участия.</span></div> : null}
      </div>

      {result.warnings.length ? <div className="pir-common-warning"><CircleAlert size={17} /><span>{result.warnings.join(" ")}</span></div> : null}
      <section className="pir-form-result">
        <div><span className="fgis-kicker">СТОИМОСТЬ ДЛЯ ВКЛЮЧЕНИЯ В 2П</span><h3>{money.format(result.totalWithoutVat)}</h3><p>Форма 3П: {money.format(result.baseTotalWithoutVat)} в исходном уровне цен × индекс {number.format(input.priceIndex)} · без НДС</p></div>
        <div className="pir-result-formula"><Calculator size={18} /><span><b>Формула:</b> средняя дневная выработка × плановый срок × численность × Ккв-уч. В расчёте это равно средней дневной выработке × взвешенные человеко-дни.</span></div>
        <button className="primary fgis-export" disabled={exporting || result.totalWithoutVat <= 0 || result.warningCount > 0} onClick={onExport}><Download size={17} /> {exporting ? "Готовим XLSX…" : "Скачать форму 3П"}</button>
      </section>
    </section>
  );
}

function TravelTripCard({
  trip,
  index,
  input,
  onChange,
  onRemove,
}: {
  trip: PirTravelTrip;
  index: number;
  input: PirTravelInput;
  onChange: (trip: PirTravelTrip) => void;
  onRemove: () => void;
}) {
  const result = calculatePirTravel({ ...input, trips: [trip] }).trips[0];
  return (
    <article className="pir-labor-work pir-travel-card">
      <div className="pir-labor-work-heading">
        <div><span className="fgis-kicker">ПОЕЗДКА · {index + 1}</span><h4>{trip.destination || "Новый пункт назначения"}</h4></div>
        <div className="pir-work-total"><span>Итого</span><strong>{money.format(result.total)}</strong><button className="pir-icon-button" onClick={onRemove} aria-label="Удалить поездку" title="Удалить поездку"><Trash2 size={16} /></button></div>
      </div>
      <div className="pir-work-fields pir-travel-fields">
        <label className="field pir-span-2"><span>Пункт назначения</span><input value={trip.destination} onChange={(event) => onChange({ ...trip, destination: event.target.value })} placeholder="Например: Санкт-Петербург" /></label>
        <label className="field"><span>Количество специалистов</span><input type="number" min="0" step="1" value={trip.specialists || ""} onChange={(event) => onChange({ ...trip, specialists: numericValue(event.target.value) })} /></label>
        <label className="field"><span>Проезд туда и обратно</span><div className="pir-number-affix"><input type="number" min="0" step="100" value={trip.roundTripFarePerPerson || ""} onChange={(event) => onChange({ ...trip, roundTripFarePerPerson: numericValue(event.target.value) })} /><b>₽/чел.</b></div></label>
        <label className="field"><span>Гостиница 3 звезды</span><div className="pir-number-affix"><input type="number" min="0" step="100" value={trip.hotelPerPersonNight || ""} onChange={(event) => onChange({ ...trip, hotelPerPersonNight: numericValue(event.target.value) })} /><b>₽/сут.</b></div></label>
        <label className="field"><span>Суточные</span><div className="pir-number-affix"><input type="number" min="0" step="100" value={trip.perDiemPerPersonDay || ""} onChange={(event) => onChange({ ...trip, perDiemPerPersonDay: numericValue(event.target.value) })} /><b>₽/сут.</b></div></label>
        <label className="field"><span>Продолжительность командировки</span><div className="pir-number-affix"><input type="number" min="0" step="1" value={trip.tripDays || ""} onChange={(event) => onChange({ ...trip, tripDays: numericValue(event.target.value) })} /><b>суток</b></div></label>
        <label className="field"><span>Проживание в гостинице</span><div className="pir-number-affix"><input type="number" min="0" step="1" value={trip.hotelNights || ""} onChange={(event) => onChange({ ...trip, hotelNights: numericValue(event.target.value) })} /><b>суток</b></div></label>
        <label className="field pir-span-2"><span>Основание стоимости</span><input value={trip.basis} onChange={(event) => onChange({ ...trip, basis: event.target.value })} placeholder="Билеты, предложение гостиницы, локальный акт о суточных" /><small className="field-hint">При фактическом возмещении расходы подтверждаются счетами, билетами и чеками.</small></label>
      </div>
      <div className="pir-cost-chain pir-travel-chain">
        <div><small>Проезд</small><b>{money.format(result.fareTotal)}</b><span>{number.format(trip.specialists)} чел. × билет туда-обратно</span></div>
        <div><small>Проживание</small><b>{money.format(result.hotelTotal)}</b><span>{number.format(trip.specialists)} чел. × {number.format(trip.hotelNights)} суток</span></div>
        <div><small>Суточные</small><b>{money.format(result.perDiemTotal)}</b><span>{number.format(trip.specialists)} чел. × {number.format(trip.tripDays)} суток</span></div>
        <div className="pir-cost-chain-total"><small>Итого по поездке</small><b>{money.format(result.total)}</b><span>налоговый режим определяется по учётным документам</span></div>
      </div>
      <div className="pir-work-footer">
        {result.warnings.length ? <span className="pir-work-warning"><CircleAlert size={15} /> {result.warnings[0]}{result.warnings.length > 1 ? ` Ещё: ${result.warnings.length - 1}.` : ""}</span> : <span className="pir-work-valid"><FileCheck2 size={15} /> Расходы заполнены</span>}
      </div>
    </article>
  );
}

export function PirTravelCalculator({ input, onChange, exporting, onExport }: {
  input: PirTravelInput;
  onChange: (value: PirTravelInput) => void;
  exporting: boolean;
  onExport: () => void;
}) {
  const result = calculatePirTravel(input);
  return (
    <section className="pir-707-calculator">
      <div className="pir-form-intro">
        <div><span className="fgis-kicker">ФОРМА 4П · ПРИКАЗ № 707/ПР</span><h2>Командировочные расходы</h2><p>Отдельный расчёт поездок, непосредственно связанных с проектированием объекта.</p></div>
        <div className="pir-form-badge"><FileCheck2 size={20} /><span><b>{money.format(result.total)}</b> по всем поездкам</span></div>
      </div>
      <div className="fgis-purpose pir-purpose-compact"><BookOpen size={22} /><div><h3>Что входит в форму 4П</h3><p>Проезд туда и обратно, гостиница класса «3 звезды» и суточные. Эти расходы не входят в расчёт 3П и добавляются отдельно при согласовании заказчика.</p></div></div>
      <details className="fgis-user-guide" open>
        <summary><span>Как заполнить расчёт</span><small>По каждой поездке</small></summary>
        <ol>
          <li><b>Укажите пункт назначения и количество специалистов.</b></li>
          <li><b>Введите стоимость на одного человека:</b> проезд туда-обратно, гостиницу за сутки и суточные.</li>
          <li><b>Укажите длительность:</b> все дни командировки и отдельно количество суток проживания.</li>
          <li><b>Запишите основание стоимости.</b> Для понесённых расходов сохраняются заверенные копии подтверждающих документов.</li>
        </ol>
      </details>
      <div className="pir-labor-list-heading"><div><span className="fgis-step-number">01</span><div><h3>Поездки</h3><p>Каждый пункт назначения рассчитывается отдельной строкой формы 4П.</p></div></div><button className="primary" onClick={() => onChange({ trips: [...input.trips, createPirTravelTrip()] })}><Plus size={17} /> Добавить поездку</button></div>
      <div className="pir-labor-list">
        {input.trips.map((trip, index) => <TravelTripCard key={trip.id} trip={trip} index={index} input={input} onChange={(next) => onChange({ trips: input.trips.map((item) => item.id === trip.id ? next : item) })} onRemove={() => onChange({ trips: input.trips.filter((item) => item.id !== trip.id) })} />)}
        {!input.trips.length ? <div className="pir-empty-list"><FileCheck2 size={26} /><b>Поездок пока нет</b><span>Добавьте поездку, чтобы сформировать форму 4П.</span></div> : null}
      </div>
      <section className="pir-form-result">
        <div><span className="fgis-kicker">ИТОГ ФОРМЫ 4П</span><h3>{money.format(result.total)}</h3><p>Командировочные расходы по всем поездкам</p></div>
        <div className="pir-result-formula"><Calculator size={18} /><span><b>Расчёт:</b> количество специалистов × (проезд + гостиница × суток проживания + суточные × дней командировки).</span></div>
        <button className="primary fgis-export" disabled={exporting || result.total <= 0 || result.warningCount > 0} onClick={onExport}><Download size={17} /> {exporting ? "Готовим XLSX…" : "Скачать форму 4П"}</button>
      </section>
    </section>
  );
}

export function PirSummary({
  passport,
  form2pResult,
  form2pName,
  laborInput,
  travelInput,
  extras,
  onExtrasChange,
  includedRowIds,
  onIncludedRowIdsChange,
  exporting,
  onExport,
  official = false,
}: {
  passport: PirEstimatePassport;
  form2pResult: SbcResult;
  form2pName: string;
  laborInput: PirLaborInput;
  travelInput: PirTravelInput;
  extras: PirSummaryExtra[];
  onExtrasChange: (value: PirSummaryExtra[]) => void;
  includedRowIds: string[];
  onIncludedRowIdsChange: (value: string[]) => void;
  exporting: boolean;
  onExport: () => void;
  official?: boolean;
}) {
  const laborResult = calculatePirLabor(laborInput);
  const travelResult = calculatePirTravel(travelInput);
  const rows = buildPirSummaryRows(
    passport,
    form2pName,
    form2pResult.currentPriceWithoutVat,
    laborResult,
    travelResult,
    extras,
    laborInput.vatRate,
    {
      basis: `${form2pResult.collectionName}; ${form2pResult.normativeTrace.source}`,
      calculation: `${form2pResult.normativeTrace.formula}; итог ${form2pResult.currentPriceWithoutVat.toFixed(2)} руб.`,
    },
  );
  const availableRows = rows.filter((row) => !official || row.source !== "4p");
  const includedRows = availableRows.filter((row) => includedRowIds.includes(row.id));
  const totalWithoutVat = includedRows.reduce((sum, item) => sum + item.costWithoutVat, 0);
  const invalidIncludedRows = includedRows.filter((row) => !row.valid);

  function toggleIncluded(rowId: string) {
    onIncludedRowIdsChange(includedRowIds.includes(rowId)
      ? includedRowIds.filter((id) => id !== rowId)
      : [...includedRowIds, rowId]);
  }

  function addManualRow() {
    const id = crypto.randomUUID();
    onExtrasChange([...extras, { id, name: "", characteristic: "", reference: "", costWithoutVat: 0 }]);
    onIncludedRowIdsChange([...includedRowIds, id]);
  }

  return (
    <section className="pir-707-calculator">
      <div className="pir-form-intro">
        <div><span className="fgis-kicker">{official ? "ФОРМА 2П · ПРИЛОЖЕНИЕ № 7" : "ПОЛЬЗОВАТЕЛЬСКИЙ СВОД ПРОЕКТА"}</span><h2>{official ? `Смета № ${passport.estimate2pNumber || "—"} на проектные работы` : "Общая стоимость проектных работ"}</h2><p>{official ? "Соберите строки сметы из нормативного расчёта, калькуляций 3П и подтверждённых дополнительных работ." : "Дополнительная рабочая ведомость выбранных расчётов."}</p></div>
        <div className="pir-form-badge"><FileCheck2 size={20} /><span><b>{includedRows.length}</b> из {availableRows.length} позиций включено</span></div>
      </div>
      <div className="fgis-purpose pir-purpose-compact"><BookOpen size={22} /><div><h3>{official ? "Одна работа — одна строка сметы" : "Каждую работу включайте только один раз"}</h3><p>{official ? "Отметьте нормативный расчёт либо калькуляцию 3П для соответствующей работы. Командировочные расходы оформляются отдельной формой 4П и не входят в форму 2П автоматически." : "Если одна и та же работа рассчитана несколькими способами, отметьте только выбранное основание."}</p></div></div>

      <div className="pir-summary-table-scroll">
        <table className="pir-summary-table">
          <thead><tr><th>В смету</th><th>№</th><th>Наименование объекта или работы</th><th>Нормативное основание</th><th>Расчёт стоимости</th><th>Сметная стоимость, руб.</th><th></th></tr></thead>
          <tbody>
            {availableRows.map((row, index) => <tr key={row.id} className={`${includedRowIds.includes(row.id) ? "is-included" : ""} ${!row.valid ? "has-warning" : ""}`}><td><label className="pir-summary-check"><input type="checkbox" checked={includedRowIds.includes(row.id)} onChange={() => toggleIncluded(row.id)} /><span className="sr-only">Включить {row.name} в смету</span></label></td><td>{index + 1}</td><th>{row.name}<small>{row.source === "2p" ? "нормативный расчёт" : row.source === "3p" ? "калькуляция 3П" : row.source === "4p" ? "расчёт 4П" : "внешний расчёт"}</small></th><td>{row.characteristic}</td><td>{row.reference}</td><td><b>{money.format(row.costWithoutVat)}</b>{!row.valid ? <small className="pir-row-warning">Нужно заполнить основания расчёта</small> : null}</td><td>{row.source === "manual" ? <button className="pir-icon-button" onClick={() => { onExtrasChange(extras.filter((item) => item.id !== row.id)); onIncludedRowIdsChange(includedRowIds.filter((id) => id !== row.id)); }} aria-label="Удалить строку"><Trash2 size={15} /></button> : null}</td></tr>)}
            {!availableRows.length ? <tr><td colSpan={7}><div className="pir-empty-list"><FileCheck2 size={26} /><b>Смета пока пуста</b><span>Выполните нормативный расчёт или калькуляцию 3П.</span></div></td></tr> : null}
          </tbody>
          <tfoot><tr><th colSpan={5}>Итого без учёта НДС</th><td>{money.format(totalWithoutVat)}</td><td></td></tr></tfoot>
        </table>
      </div>

      <details className="pir-manual-estimate">
        <summary><Plus size={16} /> Добавить дополнительную или сопутствующую работу</summary>
        <div className="pir-manual-list">
          {extras.map((item) => <div className="pir-manual-row" key={item.id}>
            <label className="field"><span>Работы</span><input value={item.name} onChange={(event) => onExtrasChange(extras.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row))} /></label>
            <label className="field"><span>Характеристика</span><input value={item.characteristic} onChange={(event) => onExtrasChange(extras.map((row) => row.id === item.id ? { ...row, characteristic: event.target.value } : row))} /></label>
            <label className="field"><span>Ссылка на документ</span><input value={item.reference} onChange={(event) => onExtrasChange(extras.map((row) => row.id === item.id ? { ...row, reference: event.target.value } : row))} /></label>
            <label className="field"><span>Стоимость без НДС</span><input type="number" min="0" value={item.costWithoutVat || ""} onChange={(event) => onExtrasChange(extras.map((row) => row.id === item.id ? { ...row, costWithoutVat: numericValue(event.target.value) } : row))} /></label>
          </div>)}
          <button className="ghost" onClick={addManualRow}><Plus size={16} /> Добавить строку</button>
        </div>
      </details>

      <section className="pir-form-result">
        <div><span className="fgis-kicker">{official ? "ИТОГО ФОРМЫ 2П БЕЗ НДС" : "ИТОГО ПО СВОДУ ПРОЕКТА"}</span><h3>{money.format(totalWithoutVat)}</h3><p>{includedRows.length} выбранных позиций</p></div>
        <div className="pir-result-formula"><FileCheck2 size={18} /><span>{official ? "XLSX формируется по пяти графам рекомендуемого образца 2П. Калькуляции 3П и расчёты-основания выгружаются отдельно." : "Это дополнительная рабочая ведомость, а не отдельная нормативная форма."}</span></div>
        <button className="primary fgis-export" disabled={exporting || includedRows.length === 0 || invalidIncludedRows.length > 0} onClick={onExport}><Download size={17} /> {exporting ? "Готовим XLSX…" : official ? "Скачать форму 2П" : "Скачать свод проекта"}</button>
      </section>
    </section>
  );
}
