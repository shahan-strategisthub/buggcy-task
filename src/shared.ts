export const statuses = ['draft', 'open', 'bidding_closed', 'assigned', 'in_progress', 'review', 'done'] as const;
export type Status = typeof statuses[number];
export const statusLabels: Record<Status, string> = {
  draft: 'Draft', open: 'Open', bidding_closed: 'Bidding closed', assigned: 'Assigned',
  in_progress: 'In progress', review: 'Review', done: 'Done',
};

export interface User { id: number; name: string }
export interface Workload { workload: number; max_capacity: number; remaining: number }
export interface Task {
  id: number;
  title: string;
  description: string;
  complexity: number;
  status: Status;
  deadline: string;
  creator_id: number;
  creator_name: string;
  assignee_id: number | null;
  assignee_name: string | null;
  bid_count: number;
  lowest_bid: number | null;
}
export interface Bid {
  id: number;
  bidder_id: number;
  bidder_name: string;
  hours: number;
  placed_at: string;
  status: 'pending' | 'accepted' | 'not_selected';
}
export interface Stats {
  by_status: { status: Status; count: number }[];
  average_by_complexity: { complexity: number; average_hours: number | null }[];
  top_users: { id: number; name: string; completed: number }[];
  overdue_without_bids: { id: number; title: string; deadline: string }[];
}
export interface Scenario {
  taskIds: number[];
  creator: User;
  bidder: User;
  fallback?: User;
  remaining: number;
}
