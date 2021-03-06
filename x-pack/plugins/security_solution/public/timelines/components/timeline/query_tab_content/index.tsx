/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import {
  EuiTabbedContent,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyoutHeader,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiSpacer,
  EuiBadge,
} from '@elastic/eui';
import { isEmpty } from 'lodash/fp';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { Dispatch } from 'redux';
import { connect, ConnectedProps } from 'react-redux';
import deepEqual from 'fast-deep-equal';
import { InPortal } from 'react-reverse-portal';

import { timelineActions, timelineSelectors } from '../../../store/timeline';
import { Direction, TimelineItem } from '../../../../../common/search_strategy';
import { useTimelineEvents } from '../../../containers/index';
import { useKibana } from '../../../../common/lib/kibana';
import { defaultHeaders } from '../body/column_headers/default_headers';
import { StatefulBody } from '../body';
import { Footer, footerHeight } from '../footer';
import { TimelineHeader } from '../header';
import { calculateTotalPages, combineQueries } from '../helpers';
import { TimelineRefetch } from '../refetch_timeline';
import { esQuery, FilterManager } from '../../../../../../../../src/plugins/data/public';
import { useManageTimeline } from '../../manage_timeline';
import { TimelineEventsType, TimelineId } from '../../../../../common/types/timeline';
import { requiredFieldsForActions } from '../../../../detections/components/alerts_table/default_config';
import { SuperDatePicker } from '../../../../common/components/super_date_picker';
import { EventDetailsWidthProvider } from '../../../../common/components/events_viewer/event_details_width_context';
import { PickEventType } from '../search_or_filter/pick_events';
import { inputsModel, inputsSelectors, State } from '../../../../common/store';
import { sourcererActions } from '../../../../common/store/sourcerer';
import { SourcererScopeName } from '../../../../common/store/sourcerer/model';
import { timelineDefaults } from '../../../../timelines/store/timeline/defaults';
import { useSourcererScope } from '../../../../common/containers/sourcerer';
import { useTimelineEventsCountPortal } from '../../../../common/hooks/use_timeline_events_count';
import { TimelineModel } from '../../../../timelines/store/timeline/model';
import { EventDetails } from '../event_details';
import { TimelineDatePickerLock } from '../date_picker_lock';
import { HideShowContainer } from '../styles';
import { useTimelineFullScreen } from '../../../../common/containers/use_full_screen';
import { activeTimeline } from '../../../containers/active_timeline_context';
import { ToggleExpandedEvent } from '../../../store/timeline/actions';

const TimelineHeaderContainer = styled.div`
  margin-top: 6px;
  width: 100%;
`;

TimelineHeaderContainer.displayName = 'TimelineHeaderContainer';

const StyledEuiFlyoutHeader = styled(EuiFlyoutHeader)`
  align-items: stretch;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  padding: 0;
`;

const StyledEuiFlyoutBody = styled(EuiFlyoutBody)`
  overflow-y: hidden;
  flex: 1;

  .euiFlyoutBody__overflow {
    overflow: hidden;
    mask-image: none;
  }

  .euiFlyoutBody__overflowContent {
    padding: 0;
    height: 100%;
    display: flex;
  }
`;

const StyledEuiFlyoutFooter = styled(EuiFlyoutFooter)`
  background: none;
  padding: 0;
`;

const FullWidthFlexGroup = styled(EuiFlexGroup)`
  margin: 0;
  width: 100%;
  overflow: hidden;
`;

const ScrollableFlexItem = styled(EuiFlexItem)`
  overflow: hidden;
`;

const DatePicker = styled(EuiFlexItem)`
  .euiSuperDatePicker__flexWrapper {
    max-width: none;
    width: auto;
  }
`;

DatePicker.displayName = 'DatePicker';

const VerticalRule = styled.div`
  width: 2px;
  height: 100%;
  background: ${({ theme }) => theme.eui.euiColorLightShade};
`;

VerticalRule.displayName = 'VerticalRule';

const StyledEuiTabbedContent = styled(EuiTabbedContent)`
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;

  > [role='tabpanel'] {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
`;

StyledEuiTabbedContent.displayName = 'StyledEuiTabbedContent';

const EventsCountBadge = styled(EuiBadge)`
  margin-left: ${({ theme }) => theme.eui.paddingSizes.s};
`;

const isTimerangeSame = (prevProps: Props, nextProps: Props) =>
  prevProps.end === nextProps.end &&
  prevProps.start === nextProps.start &&
  prevProps.timerangeKind === nextProps.timerangeKind;

interface OwnProps {
  timelineId: string;
}

const EMPTY_EVENTS: TimelineItem[] = [];

export type Props = OwnProps & PropsFromRedux;

export const QueryTabContentComponent: React.FC<Props> = ({
  columns,
  dataProviders,
  end,
  eventType,
  expandedEvent,
  filters,
  timelineId,
  isLive,
  itemsPerPage,
  itemsPerPageOptions,
  kqlMode,
  kqlQueryExpression,
  onEventClosed,
  showCallOutUnauthorizedMsg,
  showEventDetails,
  start,
  status,
  sort,
  timerangeKind,
  updateEventTypeAndIndexesName,
}) => {
  const { timelineEventsCountPortalNode } = useTimelineEventsCountPortal();
  const { timelineFullScreen } = useTimelineFullScreen();
  const {
    browserFields,
    docValueFields,
    loading: loadingSourcerer,
    indexPattern,
    selectedPatterns,
  } = useSourcererScope(SourcererScopeName.timeline);

  const { uiSettings } = useKibana().services;
  const [filterManager] = useState<FilterManager>(new FilterManager(uiSettings));
  const esQueryConfig = useMemo(() => esQuery.getEsQueryConfig(uiSettings), [uiSettings]);
  const kqlQuery = useMemo(() => ({ query: kqlQueryExpression, language: 'kuery' }), [
    kqlQueryExpression,
  ]);

  const prevCombinedQueries = useRef<{
    filterQuery: string;
  } | null>(null);
  const combinedQueries = useMemo(
    () =>
      combineQueries({
        config: esQueryConfig,
        dataProviders,
        indexPattern,
        browserFields,
        filters,
        kqlQuery,
        kqlMode,
      }),
    [browserFields, dataProviders, esQueryConfig, filters, indexPattern, kqlMode, kqlQuery]
  );

  const isBlankTimeline: boolean = useMemo(
    () => isEmpty(dataProviders) && isEmpty(filters) && isEmpty(kqlQuery.query),
    [dataProviders, filters, kqlQuery]
  );

  const canQueryTimeline = useMemo(
    () =>
      combinedQueries != null &&
      loadingSourcerer != null &&
      !loadingSourcerer &&
      !isEmpty(start) &&
      !isEmpty(end),
    [loadingSourcerer, combinedQueries, start, end]
  );

  const timelineQueryFields = useMemo(() => {
    const columnsHeader = isEmpty(columns) ? defaultHeaders : columns;
    const columnFields = columnsHeader.map((c) => c.id);

    return [...columnFields, ...requiredFieldsForActions];
  }, [columns]);

  const timelineQuerySortField = useMemo(
    () =>
      sort.map(({ columnId, sortDirection }) => ({
        field: columnId,
        direction: sortDirection as Direction,
      })),
    [sort]
  );

  const { initializeTimeline, setIsTimelineLoading } = useManageTimeline();
  useEffect(() => {
    initializeTimeline({
      filterManager,
      id: timelineId,
    });
  }, [initializeTimeline, filterManager, timelineId]);

  const [
    isQueryLoading,
    { events, inspect, totalCount, pageInfo, loadPage, updatedAt, refetch },
  ] = useTimelineEvents({
    docValueFields,
    endDate: end,
    id: timelineId,
    indexNames: selectedPatterns,
    fields: timelineQueryFields,
    limit: itemsPerPage,
    filterQuery: combinedQueries?.filterQuery ?? '',
    startDate: start,
    skip: !canQueryTimeline,
    sort: timelineQuerySortField,
    timerangeKind,
  });

  const handleOnEventClosed = useCallback(() => {
    onEventClosed({ timelineId });

    if (timelineId === TimelineId.active) {
      activeTimeline.toggleExpandedEvent({
        eventId: expandedEvent.eventId!,
        indexName: expandedEvent.indexName!,
      });
    }
  }, [timelineId, onEventClosed, expandedEvent.eventId, expandedEvent.indexName]);

  useEffect(() => {
    setIsTimelineLoading({ id: timelineId, isLoading: isQueryLoading || loadingSourcerer });
  }, [loadingSourcerer, timelineId, isQueryLoading, setIsTimelineLoading]);

  useEffect(() => {
    if (!deepEqual(prevCombinedQueries.current, combinedQueries)) {
      prevCombinedQueries.current = combinedQueries;
      handleOnEventClosed();
    }
  }, [combinedQueries, handleOnEventClosed]);

  return (
    <>
      <InPortal node={timelineEventsCountPortalNode}>
        {totalCount >= 0 ? <EventsCountBadge>{totalCount}</EventsCountBadge> : null}
      </InPortal>
      <TimelineRefetch
        id={timelineId}
        inputId="timeline"
        inspect={inspect}
        loading={isQueryLoading}
        refetch={refetch}
      />
      <FullWidthFlexGroup>
        <ScrollableFlexItem grow={2}>
          <HideShowContainer $isVisible={!timelineFullScreen}>
            <StyledEuiFlyoutHeader data-test-subj="eui-flyout-header" hasBorder={false}>
              <EuiFlexGroup gutterSize="s" data-test-subj="timeline-date-picker-container">
                <DatePicker grow={1}>
                  <SuperDatePicker id="timeline" timelineId={timelineId} />
                </DatePicker>
                <EuiFlexItem grow={false}>
                  <PickEventType
                    eventType={eventType}
                    onChangeEventTypeAndIndexesName={updateEventTypeAndIndexesName}
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
              <div>
                <EuiSpacer size="s" />
                <TimelineDatePickerLock />
                <EuiSpacer size="s" />
              </div>
              <TimelineHeaderContainer data-test-subj="timelineHeader">
                <TimelineHeader
                  filterManager={filterManager}
                  showCallOutUnauthorizedMsg={showCallOutUnauthorizedMsg}
                  timelineId={timelineId}
                  status={status}
                />
              </TimelineHeaderContainer>
            </StyledEuiFlyoutHeader>
          </HideShowContainer>

          <EventDetailsWidthProvider>
            <StyledEuiFlyoutBody data-test-subj="eui-flyout-body" className="timeline-flyout-body">
              <StatefulBody
                activePage={pageInfo.activePage}
                browserFields={browserFields}
                data={isBlankTimeline ? EMPTY_EVENTS : events}
                id={timelineId}
                refetch={refetch}
                sort={sort}
                totalPages={calculateTotalPages({
                  itemsCount: totalCount,
                  itemsPerPage,
                })}
              />
            </StyledEuiFlyoutBody>

            <StyledEuiFlyoutFooter
              data-test-subj="eui-flyout-footer"
              className="timeline-flyout-footer"
            >
              {!isBlankTimeline && (
                <Footer
                  activePage={pageInfo?.activePage ?? 0}
                  data-test-subj="timeline-footer"
                  updatedAt={updatedAt}
                  height={footerHeight}
                  id={timelineId}
                  isLive={isLive}
                  isLoading={isQueryLoading || loadingSourcerer}
                  itemsCount={isBlankTimeline ? 0 : events.length}
                  itemsPerPage={itemsPerPage}
                  itemsPerPageOptions={itemsPerPageOptions}
                  onChangePage={loadPage}
                  totalCount={isBlankTimeline ? 0 : totalCount}
                />
              )}
            </StyledEuiFlyoutFooter>
          </EventDetailsWidthProvider>
        </ScrollableFlexItem>
        {showEventDetails && (
          <>
            <VerticalRule />
            <ScrollableFlexItem grow={1}>
              <EventDetails
                browserFields={browserFields}
                docValueFields={docValueFields}
                timelineId={timelineId}
                handleOnEventClosed={handleOnEventClosed}
              />
            </ScrollableFlexItem>
          </>
        )}
      </FullWidthFlexGroup>
    </>
  );
};

const makeMapStateToProps = () => {
  const getShowCallOutUnauthorizedMsg = timelineSelectors.getShowCallOutUnauthorizedMsg();
  const getTimeline = timelineSelectors.getTimelineByIdSelector();
  const getKqlQueryTimeline = timelineSelectors.getKqlFilterQuerySelector();
  const getInputsTimeline = inputsSelectors.getTimelineSelector();
  const mapStateToProps = (state: State, { timelineId }: OwnProps) => {
    const timeline: TimelineModel = getTimeline(state, timelineId) ?? timelineDefaults;
    const input: inputsModel.InputsRange = getInputsTimeline(state);
    const {
      columns,
      dataProviders,
      eventType,
      expandedEvent,
      filters,
      itemsPerPage,
      itemsPerPageOptions,
      kqlMode,
      sort,
      status,
      timelineType,
    } = timeline;
    const kqlQueryTimeline = getKqlQueryTimeline(state, timelineId)!;
    const timelineFilter = kqlMode === 'filter' ? filters || [] : [];

    // return events on empty search
    const kqlQueryExpression =
      isEmpty(dataProviders) && isEmpty(kqlQueryTimeline) && timelineType === 'template'
        ? ' '
        : kqlQueryTimeline;
    return {
      columns,
      dataProviders,
      eventType: eventType ?? 'raw',
      end: input.timerange.to,
      expandedEvent,
      filters: timelineFilter,
      timelineId,
      isLive: input.policy.kind === 'interval',
      itemsPerPage,
      itemsPerPageOptions,
      kqlMode,
      kqlQueryExpression,
      showCallOutUnauthorizedMsg: getShowCallOutUnauthorizedMsg(state),
      showEventDetails: !!expandedEvent.eventId,
      sort,
      start: input.timerange.from,
      status,
      timerangeKind: input.timerange.kind,
    };
  };
  return mapStateToProps;
};

const mapDispatchToProps = (dispatch: Dispatch, { timelineId }: OwnProps) => ({
  updateEventTypeAndIndexesName: (newEventType: TimelineEventsType, newIndexNames: string[]) => {
    dispatch(timelineActions.updateEventType({ id: timelineId, eventType: newEventType }));
    dispatch(timelineActions.updateIndexNames({ id: timelineId, indexNames: newIndexNames }));
    dispatch(
      sourcererActions.setSelectedIndexPatterns({
        id: SourcererScopeName.timeline,
        selectedPatterns: newIndexNames,
      })
    );
  },
  onEventClosed: (args: ToggleExpandedEvent) => {
    dispatch(timelineActions.toggleExpandedEvent(args));
  },
});

const connector = connect(makeMapStateToProps, mapDispatchToProps);

type PropsFromRedux = ConnectedProps<typeof connector>;

const QueryTabContent = connector(
  React.memo(
    QueryTabContentComponent,
    (prevProps, nextProps) =>
      isTimerangeSame(prevProps, nextProps) &&
      prevProps.eventType === nextProps.eventType &&
      prevProps.isLive === nextProps.isLive &&
      prevProps.itemsPerPage === nextProps.itemsPerPage &&
      prevProps.kqlMode === nextProps.kqlMode &&
      prevProps.kqlQueryExpression === nextProps.kqlQueryExpression &&
      prevProps.onEventClosed === nextProps.onEventClosed &&
      prevProps.showCallOutUnauthorizedMsg === nextProps.showCallOutUnauthorizedMsg &&
      prevProps.showEventDetails === nextProps.showEventDetails &&
      prevProps.status === nextProps.status &&
      prevProps.timelineId === nextProps.timelineId &&
      prevProps.updateEventTypeAndIndexesName === nextProps.updateEventTypeAndIndexesName &&
      deepEqual(prevProps.columns, nextProps.columns) &&
      deepEqual(prevProps.dataProviders, nextProps.dataProviders) &&
      deepEqual(prevProps.filters, nextProps.filters) &&
      deepEqual(prevProps.itemsPerPageOptions, nextProps.itemsPerPageOptions) &&
      deepEqual(prevProps.sort, nextProps.sort)
  )
);

// eslint-disable-next-line import/no-default-export
export { QueryTabContent as default };
