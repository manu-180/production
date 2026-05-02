export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      auth_tokens: {
        Row: {
          created_at: string;
          encrypted_token: string;
          expires_at: string | null;
          id: string;
          iv: string;
          key_version: number;
          provider: string;
          revoked_at: string | null;
          tag: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted_token: string;
          expires_at?: string | null;
          id?: string;
          iv: string;
          key_version?: number;
          provider?: string;
          revoked_at?: string | null;
          tag?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          encrypted_token?: string;
          expires_at?: string | null;
          id?: string;
          iv?: string;
          key_version?: number;
          provider?: string;
          revoked_at?: string | null;
          tag?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      guardian_decisions: {
        Row: {
          confidence: number;
          context_snippet: string | null;
          created_at: string;
          decision: string;
          id: string;
          override_response: string | null;
          overridden_by_human: boolean;
          prompt_execution_id: string;
          question_detected: string;
          reasoning: string;
          requires_human_review: boolean;
          strategy: string;
        };
        Insert: {
          confidence: number;
          context_snippet?: string | null;
          created_at?: string;
          decision: string;
          id?: string;
          override_response?: string | null;
          overridden_by_human?: boolean;
          prompt_execution_id: string;
          question_detected: string;
          reasoning: string;
          requires_human_review?: boolean;
          strategy: string;
        };
        Update: {
          confidence?: number;
          context_snippet?: string | null;
          created_at?: string;
          decision?: string;
          id?: string;
          override_response?: string | null;
          overridden_by_human?: boolean;
          prompt_execution_id?: string;
          question_detected?: string;
          reasoning?: string;
          requires_human_review?: boolean;
          strategy?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_decisions_prompt_execution_id_fkey";
            columns: ["prompt_execution_id"];
            isOneToOne: false;
            referencedRelation: "prompt_executions";
            referencedColumns: ["id"];
          },
        ];
      };
      output_chunks: {
        Row: {
          channel: string;
          content: string | null;
          created_at: string;
          id: number;
          prompt_execution_id: string;
        };
        Insert: {
          channel: string;
          content?: string | null;
          created_at?: string;
          id?: number;
          prompt_execution_id: string;
        };
        Update: {
          channel?: string;
          content?: string | null;
          created_at?: string;
          id?: number;
          prompt_execution_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "output_chunks_prompt_execution_id_fkey";
            columns: ["prompt_execution_id"];
            isOneToOne: false;
            referencedRelation: "prompt_executions";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          created_at: string;
          default_settings: Json;
          default_working_dir: string | null;
          description: string | null;
          id: string;
          is_template: boolean;
          name: string;
          tags: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          default_settings?: Json;
          default_working_dir?: string | null;
          description?: string | null;
          id?: string;
          is_template?: boolean;
          name: string;
          tags?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          default_settings?: Json;
          default_working_dir?: string | null;
          description?: string | null;
          id?: string;
          is_template?: boolean;
          name?: string;
          tags?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      schedules: {
        Row: {
          cron_expression: string;
          created_at: string;
          enabled: boolean;
          id: string;
          last_run_at: string | null;
          name: string;
          next_run_at: string | null;
          plan_id: string;
          quiet_hours_end: number | null;
          quiet_hours_start: number | null;
          skip_if_recent_hours: number | null;
          skip_if_running: boolean;
          updated_at: string;
          user_id: string;
          working_dir: string | null;
        };
        Insert: {
          cron_expression: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          last_run_at?: string | null;
          name: string;
          next_run_at?: string | null;
          plan_id: string;
          quiet_hours_end?: number | null;
          quiet_hours_start?: number | null;
          skip_if_recent_hours?: number | null;
          skip_if_running?: boolean;
          updated_at?: string;
          user_id: string;
          working_dir?: string | null;
        };
        Update: {
          cron_expression?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          last_run_at?: string | null;
          name?: string;
          next_run_at?: string | null;
          plan_id?: string;
          quiet_hours_end?: number | null;
          quiet_hours_start?: number | null;
          skip_if_recent_hours?: number | null;
          skip_if_running?: boolean;
          updated_at?: string;
          user_id?: string;
          working_dir?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "schedules_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      prompt_executions: {
        Row: {
          attempt: number;
          cache_tokens: number;
          checkpoint_sha: string | null;
          claude_session_id: string | null;
          cost_usd: number;
          created_at: string;
          duration_ms: number | null;
          error_code: string | null;
          error_message: string | null;
          error_raw: string | null;
          finished_at: string | null;
          id: string;
          input_tokens: number;
          output_tokens: number;
          prompt_id: string;
          run_id: string;
          started_at: string | null;
          status: string;
        };
        Insert: {
          attempt?: number;
          cache_tokens?: number;
          checkpoint_sha?: string | null;
          claude_session_id?: string | null;
          cost_usd?: number;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          error_raw?: string | null;
          finished_at?: string | null;
          id?: string;
          input_tokens?: number;
          output_tokens?: number;
          prompt_id: string;
          run_id: string;
          started_at?: string | null;
          status?: string;
        };
        Update: {
          attempt?: number;
          cache_tokens?: number;
          checkpoint_sha?: string | null;
          claude_session_id?: string | null;
          cost_usd?: number;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          error_raw?: string | null;
          finished_at?: string | null;
          id?: string;
          input_tokens?: number;
          output_tokens?: number;
          prompt_id?: string;
          run_id?: string;
          started_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prompt_executions_prompt_id_fkey";
            columns: ["prompt_id"];
            isOneToOne: false;
            referencedRelation: "prompts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_executions_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "runs";
            referencedColumns: ["id"];
          },
        ];
      };
      prompts: {
        Row: {
          content: string;
          content_hash: string | null;
          created_at: string;
          filename: string | null;
          frontmatter: Json;
          id: string;
          order_index: number;
          plan_id: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          content: string;
          content_hash?: string | null;
          created_at?: string;
          filename?: string | null;
          frontmatter?: Json;
          id?: string;
          order_index: number;
          plan_id: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          content?: string;
          content_hash?: string | null;
          created_at?: string;
          filename?: string | null;
          frontmatter?: Json;
          id?: string;
          order_index?: number;
          plan_id?: string;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prompts_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      run_events: {
        Row: {
          created_at: string;
          event_type: string;
          id: number;
          payload: Json;
          prompt_execution_id: string | null;
          run_id: string;
          sequence: number;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: number;
          payload?: Json;
          prompt_execution_id?: string | null;
          run_id: string;
          sequence: number;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: number;
          payload?: Json;
          prompt_execution_id?: string | null;
          run_id?: string;
          sequence?: number;
        };
        Relationships: [
          {
            foreignKeyName: "run_events_prompt_execution_id_fkey";
            columns: ["prompt_execution_id"];
            isOneToOne: false;
            referencedRelation: "prompt_executions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "run_events_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "runs";
            referencedColumns: ["id"];
          },
        ];
      };
      runs: {
        Row: {
          cancellation_reason: string | null;
          checkpoint_branch: string | null;
          created_at: string;
          current_prompt_index: number | null;
          finished_at: string | null;
          id: string;
          last_heartbeat_at: string | null;
          plan_id: string;
          started_at: string | null;
          status: string;
          total_cache_tokens: number;
          total_cost_usd: number;
          total_input_tokens: number;
          total_output_tokens: number;
          triggered_by: string;
          updated_at: string;
          user_id: string;
          working_dir: string;
        };
        Insert: {
          cancellation_reason?: string | null;
          checkpoint_branch?: string | null;
          created_at?: string;
          current_prompt_index?: number | null;
          finished_at?: string | null;
          id?: string;
          last_heartbeat_at?: string | null;
          plan_id: string;
          started_at?: string | null;
          status?: string;
          total_cache_tokens?: number;
          total_cost_usd?: number;
          total_input_tokens?: number;
          total_output_tokens?: number;
          triggered_by?: string;
          updated_at?: string;
          user_id: string;
          working_dir: string;
        };
        Update: {
          cancellation_reason?: string | null;
          checkpoint_branch?: string | null;
          created_at?: string;
          current_prompt_index?: number | null;
          finished_at?: string | null;
          id?: string;
          last_heartbeat_at?: string | null;
          plan_id?: string;
          started_at?: string | null;
          status?: string;
          total_cache_tokens?: number;
          total_cost_usd?: number;
          total_input_tokens?: number;
          total_output_tokens?: number;
          triggered_by?: string;
          updated_at?: string;
          user_id?: string;
          working_dir?: string;
        };
        Relationships: [
          {
            foreignKeyName: "runs_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      integrations: {
        Row: {
          id: string;
          user_id: string;
          channel: string;
          config: Json;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          channel: string;
          config?: Json;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          channel?: string;
          config?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      webhook_endpoints: {
        Row: {
          id: string;
          user_id: string;
          plan_id: string;
          name: string;
          secret: string;
          source: string;
          github_event: string | null;
          enabled: boolean;
          last_triggered_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan_id: string;
          name: string;
          secret: string;
          source?: string;
          github_event?: string | null;
          enabled?: boolean;
          last_triggered_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          plan_id?: string;
          name?: string;
          secret?: string;
          source?: string;
          github_event?: string | null;
          enabled?: boolean;
          last_triggered_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          id: string;
          user_id: string;
          event_type: string;
          channel: string;
          enabled: boolean;
          severity_threshold: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_type: string;
          channel: string;
          enabled?: boolean;
          severity_threshold?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          event_type?: string;
          channel?: string;
          enabled?: boolean;
          severity_threshold?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          auto_approve_low_risk: boolean;
          default_model: string;
          git_auto_commit: boolean;
          git_auto_push: boolean;
          notification_channels: Json;
          theme: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          auto_approve_low_risk?: boolean;
          default_model?: string;
          git_auto_commit?: boolean;
          git_auto_push?: boolean;
          notification_channels?: Json;
          theme?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          auto_approve_low_risk?: boolean;
          default_model?: string;
          git_auto_commit?: boolean;
          git_auto_push?: boolean;
          notification_channels?: Json;
          theme?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      worker_instances: {
        Row: {
          hostname: string | null;
          id: string;
          last_seen_at: string;
          metadata: Json;
          pid: number | null;
          started_at: string;
        };
        Insert: {
          hostname?: string | null;
          id: string;
          last_seen_at?: string;
          metadata?: Json;
          pid?: number | null;
          started_at?: string;
        };
        Update: {
          hostname?: string | null;
          id?: string;
          last_seen_at?: string;
          metadata?: Json;
          pid?: number | null;
          started_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      compute_run_totals: { Args: { p_run_id: string }; Returns: undefined };
      enqueue_run: {
        Args: {
          p_plan_id: string;
          p_triggered_by?: string;
          p_user_id: string;
          p_working_dir: string;
        };
        Returns: string;
      };
      next_event_sequence: { Args: { p_run_id: string }; Returns: number };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
